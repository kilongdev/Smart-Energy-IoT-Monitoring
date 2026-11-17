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
  // Cache thiết bị 15s để 15 gateway (7-8 bản tin/s) không quét devices
  // trên Atlas mỗi lần ingest; ACK/lệnh vẫn đọc DB trực tiếp nên luôn tươi.
  private readonly deviceCache = new Map<string, { doc: any; at: number }>();
  // Chặn ghi lastSeen dồn dập: 15 gateway * 2s = 7-8 write/s chỉ để đánh
  // dấu online. Giữ 1 write / 5s / thiết bị, vẫn đủ cho isOnline().
  private readonly lastSeenMark = new Map<string, number>();
  // Hàng đợi chậm (alerts + rollup + processed) chạy nền, giới hạn đồng
  // thời để không bóp nghẹt Atlas khi 15 gateway dồn mẫu cùng lúc.
  private slowActive = 0;
  private readonly slowQueue: Array<() => void> = [];
  private static readonly SLOW_CONCURRENCY = 4;
  // Chặn dirty_hours dồn dập: rollup theo giờ không cần đánh dấu mỗi mẫu
  // 2s. Giữ 1 dirty / 60s / thiết bị là đủ cho flush tính lại.
  private readonly dirtyMark = new Map<string, number>();
  // Cache "thiết bị có rule hay không" 60s để bỏ qua evaluate/lock cho
  // 15 máy ảo (đa số không có rule), giữ slot Atlas cho Wokwi A101/B101.
  private readonly ruleMark = new Map<string, { at: number; has: boolean }>();

  private async getDevice(id: string) {
    const cached = this.deviceCache.get(id);
    if (cached && Date.now() - cached.at < 15_000) return cached.doc;
    const doc = await this.catalog.get('devices', id);
    this.deviceCache.set(id, { doc, at: Date.now() });
    return doc;
  }

  private enqueueSlow(task: () => Promise<void>) {
    const run = () => {
      this.slowActive++;
      task()
        .catch((error) => this.log.warn('Slow telemetry: ' + error.message))
        .finally(() => {
          this.slowActive--;
          const next = this.slowQueue.shift();
          if (next) next();
        });
    };
    if (this.slowActive >= Telemetry.SLOW_CONCURRENCY) {
      // Bỏ mẫu cũ nhất khi tắc để Wokwi mới nhất luôn được xử lý.
      if (this.slowQueue.length > 200) this.slowQueue.shift();
      this.slowQueue.push(run);
    } else {
      run();
    }
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

    // Đánh dấu online ngay khi nhận bản tin hợp lệ (đã qua DTO validation
    // ở tầng MQTT), không đợi hàng đợi xử lý xong. Chặn còn 1 write/5s/
    // thiết bị: 15 gateway * 2s = 7-8 write/s chỉ để đánh dấu online là
    // quá tải cho Atlas free-tier và làm chậm cả đường ACK của Wokwi.
    // Bản tin replay lại dữ liệu cũ nên không được đánh dấu (markOnline=false).
    if (markOnline) {
      const last = this.lastSeenMark.get(id) || 0;
      if (Date.now() - last >= 5000) {
        this.lastSeenMark.set(id, Date.now());
        this.db.collection('devices').updateOne(
          { _id: id },
          { $set: { lastSeen: new Date() } },
        ).catch(() => {});
      }
    }

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

    // Đường nhanh (target 1-2s cho Wokwi): insert lịch sử + cập nhật latest
    // chạy song song, chỉ 2 round-trip Atlas thay vì 4-5 nối tiếp.
    // lastSeen đã được đánh dấu có chặn 5s trong ingest() nên bỏ write
    // trùng lặp ở đây để giảm một nửa tải ghi lên Atlas free-tier.
    let duplicate = false;
    const insertPromise = this.db.collection('telemetry').insertOne(record).catch((error: any) => {
      if (error?.code !== 11000) throw error;
      duplicate = true;
      return null;
    });
    const fastPromise = this.processFast(device, record);
    await Promise.all([insertPromise, fastPromise]);

    if (duplicate) {
      row = await this.db.collection('telemetry').findOne({
        ma_thiet_bi: device._id,
        thoi_gian_do: measured,
      });
      if (row && !row.processed) {
        this.enqueueSlow(() => this.processSlow(device, row));
      }
    } else if (!row.processed) {
      // Đường chậm chạy nền, giới hạn đồng thời để 15 gateway dồn mẫu
      // không bóp nghẹt Atlas và không chặn mẫu mới của Wokwi.
      this.enqueueSlow(() => this.processSlow(device, row));
    }

    return {
      message: duplicate
        ? 'Bản ghi trùng đã được bỏ qua'
        : 'Ghi nhận dữ liệu đo thành công',
      duplicate,
    };
  }

  // Cập nhật dashboard trong 1-2s: 2 write song song + emit socket.
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

  // Việc nặng không được chặn dashboard: đánh giá cảnh báo + rollup giờ
  // + đánh dấu processed. Chạy nền qua enqueueSlow (tối đa 4 đồng thời).
  private async hasRules(deviceId: string) {
    const cached = this.ruleMark.get(deviceId);
    if (cached && Date.now() - cached.at < 60_000) return cached.has;
    const count = await this.db
      .collection('rules')
      .countDocuments({ ma_thiet_bi: deviceId, bat: true }, { limit: 1 });
    const has = count > 0;
    this.ruleMark.set(deviceId, { at: Date.now(), has });
    return has;
  }

  private async processSlow(device: any, row: any) {
    // Publish the stored measurement before alert evaluation and rollups;
    // neither may hold the dashboard behind a slow database round trip.
    // Alert evaluation owns freshness validation and logs why stale samples
    // cannot advance recovery. Do not silently discard them with another limit.
    // 15 máy ảo đa số không có rule: bỏ qua evaluate + lock để giữ slot
    // Atlas cho Wokwi A101/B101 (vốn có rule và cần phản hồi 1-2s).
    if (await this.hasRules(device._id)) {
      await this.alerts.evaluate(device, row);
    }
    // Rollup theo giờ không cần đánh dấu mỗi mẫu 2s: giữ 1 dirty / 60s /
    // thiết bị là đủ cho flush tính lại, giảm ~30x write lên dirty_hours.
    const lastDirty = this.dirtyMark.get(device._id) || 0;
    if (Date.now() - lastDirty >= 60_000) {
      this.dirtyMark.set(device._id, Date.now());
      await this.analytics.dirty(device._id, row.thoi_gian_do);
    }

    await this.db.collection('telemetry').updateOne(
      { _id: row._id },
      {
        $set: { processed: true },
      },
    );
  }

  private async process(device: any, row: any) {
    await this.processFast(device, row);
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
