import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { Alerts } from './alerts';
import { Analytics } from './analytics';
import { Catalog } from './catalog';
import { Database } from './database';
import { Events } from './events';

@Injectable()
export class Telemetry
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly queues = new Map<string, Promise<any>>();
  private readonly deviceCache = new Map<string, { doc: any; at: number }>();

  private async getDevice(id: string) {
    const cached = this.deviceCache.get(id);
    if (cached && Date.now() - cached.at < 15_000) return cached.doc;
    const doc = await this.catalog.get('devices', id);
    this.deviceCache.set(id, { doc, at: Date.now() });
    return doc;
  }

  private timer?: NodeJS.Timeout;
  private replaying = false;

  private readonly log = new Logger(Telemetry.name);

  constructor(
    private readonly db: Database,
    private readonly catalog: Catalog,
    private readonly alerts: Alerts,
    private readonly analytics: Analytics,
    private readonly events: Events,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.replay().catch((error) => {
        this.log.error(error.message);
      });
    }, 5000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  ingest(dto: any, topic?: string, markOnline = true, receivedAt = new Date()) {
    const id = dto.ma_thiet_bi;

    // Preserve sample order through evaluation, separately for each device.
    const work = (this.queues.get(id) || Promise.resolve())
      .catch(() => {})
      .then(() => this.handle(dto, topic, receivedAt));

    this.queues.set(id, work);

    work
      .finally(() => {
        if (this.queues.get(id) === work) {
          this.queues.delete(id);
        }
      })
      .catch(() => {});

    return work;
  }

  private async handle(dto: any, topic?: string, receivedAt = new Date()) {
    const device = await this.getDevice(dto.ma_thiet_bi);

    if (
      topic &&
      topic !== `${device.chu_de_mqtt}/telemetry`
    ) {
      throw new BadRequestException(
        'Topic và mã thiết bị không khớp',
      );
    }

    const measured = new Date(dto.thoi_gian_do);
    const now = new Date();

    if (
      +measured > +now + 5000 ||
      +measured < +now - 2_592_000_000
    ) {
      throw new BadRequestException(
        'Thời điểm đo ngoài cửa sổ 30 ngày hoặc nằm trong tương lai',
      );
    }

    const record = {
      ...dto,
      _id: randomUUID(),
      thoi_gian_do: measured,
      receivedAt,
      buildingId: device.buildingId,
      ma_phong: device.ma_phong,
      processed: false,
    };

    let row: any = record;

    let duplicate = false;
    try {
      await this.db.collection('telemetry').insertOne(record);
    } catch (error: any) {
      if (error.code !== 11000) throw error;
      duplicate = true;
      row = await this.db.collection('telemetry').findOne({
        ma_thiet_bi: device._id, thoi_gian_do: measured,
      });
    }
    if (row && !row.processed) await this.process(device, row);

    return {
      message: duplicate
        ? 'Bản ghi trùng đã được bỏ qua'
        : 'Ghi nhận dữ liệu đo thành công',
      duplicate,
    };
  }

  private async processFast(device: any, row: any) {
    const [updated] = await Promise.all([
      this.db
        .collection('devices')
        .findOneAndUpdate(
          {
            _id: device._id,
            $or: [
              {
                'latest.thoi_gian_do': {
                  $lt: row.thoi_gian_do,
                },
              },
              {
                latest: { $exists: false },
              },
            ],
          },
          {
            $max: { lastSeen: row.receivedAt },
            $set: {
              latest: {
                thoi_gian_do: row.thoi_gian_do,
                receivedAt: row.receivedAt,
                cong_suat_w: row.cong_suat_w,
                dien_ap_v: row.dien_ap_v,
                dong_dien_a: row.dong_dien_a,
                nhiet_do_c: row.nhiet_do_c,
                chi_tiet_mo_phong: row.chi_tiet_mo_phong,
              },
            },
          },
          { returnDocument: 'after' },
        ),
      this.db.collection('devices').updateOne(
        {
          _id: device._id,
          $or: [
            { lastRelayAt: { $lte: row.receivedAt } },
            { lastRelayAt: { $exists: false } },
          ],
        },
        {
          $max: { lastSeen: row.receivedAt },
          $set: {
            trang_thai_relay: row.trang_thai_relay,
            lastRelayAt: row.receivedAt,
          },
        },
      ),
    ]);

    if (updated) {
      this.events.send(
        device.buildingId,
        'telemetry',
        {
          ma_thiet_bi: device._id,
          ...updated.latest,
          receivedAt: row.receivedAt,
        },
      );
    }
  }

  private async processSlow(device: any, row: any) {
    // Independent work shares the same persisted sample. Wait for ALL paths,
    // including failures, before advancing this device's queue or marking done.
    const results = await Promise.allSettled([
      this.processFast(device, row),
      this.alerts.evaluate(device, row),
      this.analytics.dirty(device._id, row.thoi_gian_do),
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;

    await this.db.collection('telemetry').updateOne(
      { _id: row._id },
      {
        $set: { processed: true },
      },
    );
  }

  private async process(device: any, row: any) {
    await this.processSlow(device, row);
  }

  private async replay() {
    if (this.replaying) {
      return;
    }

    this.replaying = true;

    try {
      const rows = await this.db
        .collection('telemetry')
        .find({ processed: false })
        .sort({ receivedAt: 1 })
        .limit(100)
        .toArray();

      for (const row of rows) {
        // Do not append another copy of work already queued for this device.
        if (this.queues.has(row.ma_thiet_bi)) continue;
        const {
          _id,
          receivedAt,
          buildingId,
          ma_phong,
          processed,
          ...dto
        } = row;

        await this.ingest({
          ...dto,
          thoi_gian_do: row.thoi_gian_do.toISOString(),
        }, undefined, false);
      }
    } finally {
      this.replaying = false;
    }
  }
}
