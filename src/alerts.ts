import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { Catalog } from './catalog';
import { Database } from './database';
import { compare, defined, inWindow, User } from './domain';
import { Events } from './events';
import { Security } from './security';

@Injectable()
export class Alerts implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private sending = false;

  private readonly log = new Logger(Alerts.name);

  constructor(
    private readonly db: Database,
    private readonly events: Events,
    private readonly catalog: Catalog,
    private readonly security: Security,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.notifications().catch((error) => {
        this.log.error(error.message);
      });
    }, 1000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Lấy danh sách quy tắc trong phạm vi được phép truy cập.
  async rules(user: User) {
    return this.db
      .collection('rules')
      .find(this.security.buildingFilter(user))
      .sort({ createdAt: -1 })
      .toArray();
  }

  // Tạo mới hoặc cập nhật quy tắc cảnh báo.
  async saveRule(dto: any, user: User, id?: string) {
    dto = defined(dto);

    const oldRule = id
      ? await this.db.collection('rules').findOne({ _id: id })
      : null;

    if (id && !oldRule) {
      throw new ConflictException('Quy tắc không tồn tại');
    }

    if (oldRule) {
      this.security.checkBuilding(user, oldRule.buildingId);
    }

    const data = {
      thoi_gian_duy_tri: 10,
      cooldown: 60,
      muc_do: 'HIGH',
      bat: true,
      ...oldRule,
      ...dto,
    };

    const device = await this.catalog.get(
      'devices',
      data.ma_thiet_bi,
      user,
    );

    const item = {
      ...data,
      _id: id || randomUUID(),
      buildingId: device.buildingId,
      ma_phong: device.ma_phong,
      start: null,
      lastSample: null,
      updatedAt: new Date(),
      createdAt: oldRule?.createdAt || new Date(),
    };

    await this.db.collection('rules').replaceOne(
      { _id: item._id },
      item,
      { upsert: true },
    );

    return {
      ...item,
      ma_quy_tac: item._id,
    };
  }

  // Đánh giá mẫu đo theo các quy tắc đang bật của thiết bị.
  async evaluate(device: any, sample: any) {
    const rules = await this.db
      .collection('rules')
      .find({
        ma_thiet_bi: device._id,
        bat: true,
      })
      .toArray();

    const measured = +sample.thoi_gian_do;

    for (const rule of rules) {
      if (rule.lastSample && measured <= +rule.lastSample) {
        continue;
      }

      const violation =
        inWindow(sample.thoi_gian_do, rule.khung_gio_ap_dung) &&
        compare(
          sample[rule.chi_so_can_do],
          rule.toan_tu,
          rule.gia_tri_nguong,
        );

      const isContinuous =
        rule.start &&
        rule.lastSample &&
        measured - +rule.lastSample <= device.chu_ky_gui * 3000;

      let start = null;

      if (violation) {
        start = isContinuous ? rule.start : sample.thoi_gian_do;
      }

      await this.db.collection('rules').updateOne(
        {
          _id: rule._id,
          updatedAt: rule.updatedAt,
        },
        {
          $set: {
            start,
            lastSample: sample.thoi_gian_do,
          },
        },
      );

      if (
        !start ||
        measured - +start < rule.thoi_gian_duy_tri * 1000
      ) {
        continue;
      }

      // Giữ lượt cooldown trước khi đưa thông báo vào hàng chờ.
      const now = new Date();

      const claimed = await this.db.collection('rules').findOneAndUpdate(
        {
          _id: rule._id,
          bat: true,
          updatedAt: rule.updatedAt,
          $or: [
            { lastAttempt: { $exists: false } },
            { lastAttempt: null },
            {
              lastAttempt: {
                $lte: new Date(+now - rule.cooldown * 1000),
              },
            },
          ],
        },
        {
          $set: {
            lastAttempt: now,
          },
        },
        { returnDocument: 'after' },
      );

      if (!claimed) {
        continue;
      }

      let alert = await this.db.collection('alerts').findOne(
        {
          ma_quy_tac: rule._id,
          trang_thai: {
            $in: ['Mới', 'Đã xác nhận'],
          },
        },
        {
          sort: {
            thoi_gian_phat_hien: -1,
          },
        },
      );

      const message =
        `${device.ten_thiet_bi}: ` +
        `${rule.chi_so_can_do} = ${sample[rule.chi_so_can_do]} ` +
        `(${rule.toan_tu} ${rule.gia_tri_nguong}). ` +
        now.toISOString();

      if (!alert) {
        alert = {
          _id: randomUUID(),
          ma_quy_tac: rule._id,
          ma_thiet_bi: device._id,
          buildingId: device.buildingId,
          ma_phong: device.ma_phong,
          thoi_gian_phat_hien: now,
          trang_thai: 'Mới',
          muc_do: rule.muc_do,
          noi_dung_loi: message,
          snapshot: {
            rule: {
              ten_quy_tac: rule.ten_quy_tac,
              chi_so_can_do: rule.chi_so_can_do,
              toan_tu: rule.toan_tu,
              gia_tri_nguong: rule.gia_tri_nguong,
            },
            sample,
          },
          occurrences: 0,
        };

        await this.db.collection('alerts').insertOne(alert);
      }

      await this.db.collection('alerts').updateOne(
        { _id: alert._id },
        {
          $set: {
            lastSeen: now,
            trang_thai_gui: 'Đang chờ',
            notificationText: message,
            nextRetry: now,
            attempts: 0,
            cooldown: rule.cooldown,
          },
          $inc: {
            occurrences: 1,
          },
        },
      );

      this.events.send(
        device.buildingId,
        'alert',
        {
          id: alert._id,
          message,
        },
        true,
      );
    }
  }

  // Tra cứu lịch sử cảnh báo.
  async history(user: User, filter: any) {
    const query: any = {
      ...this.security.buildingFilter(user),
    };

    for (const key of ['ma_phong', 'muc_do', 'trang_thai']) {
      if (filter[key]) {
        query[key] = String(filter[key]);
      }
    }

    if (filter.from || filter.to) {
      query.thoi_gian_phat_hien = {};

      for (const [key, operator] of [
        ['from', '$gte'],
        ['to', '$lt'],
      ]) {
        if (!filter[key]) {
          continue;
        }

        const date = new Date(filter[key]);

        if (!Number.isFinite(+date)) {
          throw new ConflictException('Thời gian không hợp lệ');
        }

        query.thoi_gian_phat_hien[operator] = date;
      }
    }

    return this.db
      .collection('alerts')
      .find(query)
      .sort({ thoi_gian_phat_hien: -1 })
      .limit(500)
      .toArray();
  }

  // Chuyển trạng thái cảnh báo và lưu lịch sử thao tác.
  async transition(id: string, dto: any, user: User) {
    const alert = await this.db
      .collection('alerts')
      .findOne({ _id: id });

    if (!alert) {
      throw new ConflictException('Không tìm thấy cảnh báo');
    }

    this.security.checkBuilding(user, alert.buildingId);

    const expectedStatus =
      dto.trang_thai === 'Đã xác nhận' ? 'Mới' : 'Đã xác nhận';

    const changed = await this.db.collection('alerts').findOneAndUpdate(
      {
        _id: id,
        trang_thai: expectedStatus,
      },
      {
        $set: {
          trang_thai: dto.trang_thai,
        },
        $push: {
          history: {
            userId: user._id,
            at: new Date(),
            trang_thai: dto.trang_thai,
            ghi_chu: dto.ghi_chu || '',
          },
        },
      } as any,
      { returnDocument: 'after' },
    );

    if (!changed) {
      throw new ConflictException(
        'Trạng thái đã thay đổi hoặc chưa xác nhận cảnh báo',
      );
    }

    this.events.send(alert.buildingId, 'alert', { id }, true);

    return changed;
  }

  // Gửi thông báo Telegram và xử lý các lần gửi lại.
  async notifications() {
    if (this.sending) {
      return;
    }

    this.sending = true;

    try {
      const pending = await this.db
        .collection('alerts')
        .find({
          trang_thai_gui: {
            $in: ['Đang chờ', 'Thất bại'],
          },
          nextRetry: {
            $lte: new Date(),
          },
          attempts: {
            $lt: 3,
          },
        })
        .limit(10)
        .toArray();

      await Promise.all(
        pending.map(async (alert) => {
          const token = process.env.TELEGRAM_BOT_TOKEN;
          const chatId = process.env.TELEGRAM_CHAT_ID;

          if (!token || !chatId) {
            await this.db.collection('alerts').updateOne(
              { _id: alert._id },
              {
                $set: {
                  trang_thai_gui: 'Chưa cấu hình',
                },
              },
            );

            return;
          }

          let state = 'Thành công';
          let error = '';

          try {
            const response = await fetch(
              `https://api.telegram.org/bot${token}/sendMessage`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: alert.notificationText,
                }),
                signal: AbortSignal.timeout(3000),
              },
            );

            const result: any = await response.json();

            if (!response.ok || !result.ok) {
              throw new Error(`Telegram HTTP ${response.status}`);
            }
          } catch (cause) {
            state = 'Thất bại';
            error = cause instanceof Error ? cause.message : 'Lỗi gửi';
          }

          const now = new Date();
          const retryDelay = Math.max(alert.cooldown, 30) * 1000;

          await this.db.collection('alerts').updateOne(
            { _id: alert._id },
            {
              $set: {
                trang_thai_gui: state,
                nextRetry: new Date(+now + retryDelay),
              },
              $inc: {
                attempts: 1,
              },
              $push: {
                deliveryLog: {
                  at: now,
                  state,
                  error,
                },
              },
            } as any,
          );
        }),
      );
    } finally {
      this.sending = false;
    }
  }
}