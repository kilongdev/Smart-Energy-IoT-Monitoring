import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { Catalog } from './catalog';
import { Control } from './control';
import { Database } from './database';
import { defined, localClock, User } from './domain';
import { Security } from './security';

@Injectable()
export class Schedules
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private busy = false;

  private readonly log = new Logger(Schedules.name);

  constructor(
    private readonly db: Database,
    private readonly catalog: Catalog,
    private readonly security: Security,
    private readonly control: Control,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.log.error(error.message);
      });
    }, 1000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async list(user: User) {
    return this.db
      .collection('schedules')
      .find(this.security.buildingFilter(user))
      .sort({ createdAt: -1 })
      .toArray();
  }

  async save(dto: any, user: User, id?: string) {
    dto = defined(dto);

    const oldSchedule = id
      ? await this.db.collection('schedules').findOne({ _id: id })
      : null;

    if (id && !oldSchedule) {
      throw new ConflictException('Lịch không tồn tại');
    }

    if (oldSchedule) {
      this.security.checkBuilding(user, oldSchedule.buildingId);
    }

    const data = {
      bat: true,
      ...oldSchedule,
      ...dto,
    };

    const device = await this.catalog.get(
      'devices',
      data.ma_thiet_bi,
      user,
    );

    if (!device.cho_phep_dieu_khien) {
      throw new ConflictException(
        'Thiết bị không hỗ trợ điều khiển',
      );
    }

    const days = [
      ...new Set<string>(data.ngay_lap_lai.split(',')),
    ];

    const conflict = await this.db.collection('schedules').findOne({
      _id: { $ne: id || '' },
      ma_thiet_bi: device._id,
      gio_bat_dau: data.gio_bat_dau,
      days: { $in: days },
      bat: true,
    });

    if (data.bat !== false && conflict) {
      throw new ConflictException(
        'Đã có lịch cùng thiết bị, giờ và ngày',
      );
    }

    const row = {
      ...data,
      _id: id || randomUUID(),
      buildingId: device.buildingId,
      days,
      timezone: 'Asia/Ho_Chi_Minh',
      createdAt: oldSchedule?.createdAt || new Date(),
      updatedAt: new Date(),
    };

    await this.db.collection('schedules').replaceOne(
      { _id: row._id },
      row,
      { upsert: true },
    );

    return {
      ...row,
      ma_lich_trinh: row._id,
    };
  }

  async remove(id: string, user: User) {
    const oldSchedule = await this.db
      .collection('schedules')
      .findOne({ _id: id });

    if (!oldSchedule) {
      throw new ConflictException('Lịch không tồn tại');
    }

    this.security.checkBuilding(user, oldSchedule.buildingId);

    await this.db.collection('schedules').deleteOne({ _id: id });

    return {
      message: 'Đã xóa lịch, giữ nhật ký lần chạy',
    };
  }

  async tick(now = new Date()) {
    if (this.busy) {
      return;
    }

    this.busy = true;

    try {
      const clock = localClock(now);

      const schedules = await this.db
        .collection('schedules')
        .find({
          bat: true,
          days: clock.day,
        })
        .toArray();

      const seconds = (time: string) =>
        time
          .split(':')
          .reduce((total, value) => total * 60 + Number(value), 0);

      for (const schedule of schedules) {
        const lag =
          seconds(clock.time) - seconds(schedule.gio_bat_dau);

        if (lag < 0) {
          continue;
        }

        const runId =
          `${schedule._id}:${clock.date}:${schedule.gio_bat_dau}`;

        // Newly created/edited schedules do not retroactively generate a run before their edit.
        const edit = localClock(schedule.updatedAt);

        if (
          edit.date === clock.date &&
          edit.time > schedule.gio_bat_dau
        ) {
          continue;
        }

        try {
          await this.db.collection('schedule_runs').insertOne({
            _id: runId,
            ma_lich_trinh: schedule._id,
            buildingId: schedule.buildingId,
            createdAt: now,
            status: lag <= 5 ? 'Đang chạy' : 'Bị lỡ',
            lagSeconds: lag,
          });
        } catch (error: any) {
          if (error.code === 11000) {
            continue;
          }

          throw error;
        }

        if (lag > 5) {
          continue;
        }

        const currentSchedule = await this.db
          .collection('schedules')
          .findOne({
            _id: schedule._id,
            bat: true,
            updatedAt: schedule.updatedAt,
          });

        if (!currentSchedule) {
          await this.db.collection('schedule_runs').updateOne(
            { _id: runId },
            {
              $set: { status: 'Đã hủy' },
            },
          );

          continue;
        }

        try {
          const command = await this.control.send(
            schedule.ma_thiet_bi,
            schedule.hanh_dong,
            null,
            {
              id: schedule._id,
              runId,
            },
          );

          await this.db.collection('schedule_runs').updateOne(
            { _id: runId },
            {
              $set: {
                status: 'Đã tạo lệnh',
                ma_lenh: command._id,
              },
            },
          );
        } catch (error: any) {
          await this.db.collection('schedule_runs').updateOne(
            { _id: runId },
            {
              $set: {
                status: 'Thất bại',
                error: error.message,
              },
            },
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
}