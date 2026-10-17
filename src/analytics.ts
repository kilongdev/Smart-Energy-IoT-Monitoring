import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

import { Catalog } from './catalog';
import { Database } from './database';
import {
  energyBetween,
  HOUR,
  hourStart,
  isOnline,
  User,
} from './domain';
import { Security } from './security';

@Injectable()
export class Analytics implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;

  private readonly log = new Logger(Analytics.name);

  constructor(
    private readonly db: Database,
    private readonly security: Security,
    private readonly catalog: Catalog,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.flush().catch((error) => {
        this.log.error(error.message);
      });
    }, 2000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Đánh dấu các khoảng giờ cần tính lại khi có mẫu đo mới.
  async dirty(deviceId: string, time: Date) {
    const hour = +hourStart(time);

    // Mẫu đến sai thứ tự gần ranh giới giờ có thể ảnh hưởng giờ liền kề.
    const affectedHours = [
      hour - HOUR,
      hour,
      hour + HOUR,
    ];

    for (const affectedHour of affectedHours) {
      await this.db.collection('dirty_hours').updateOne(
        {
          _id: `${deviceId}:${affectedHour}`,
        },
        {
          $set: {
            deviceId,
            hour: new Date(affectedHour),
          },
          $inc: {
            revision: 1,
          },
        },
        { upsert: true },
      );
    }
  }

  // Tính lại điện năng cho các khoảng giờ đã được đánh dấu.
  async flush() {
    if (this.busy) {
      return;
    }

    this.busy = true;

    try {
      const tasks = await this.db
        .collection('dirty_hours')
        .find()
        .limit(150)
        .toArray();

      for (const task of tasks) {
        const device = await this.db
          .collection('devices')
          .findOne({ _id: task.deviceId });

        if (!device) {
          await this.db
            .collection('dirty_hours')
            .deleteOne({ _id: task._id });

          continue;
        }

        const start = +task.hour;
        const end = start + HOUR;
        const gap = device.chu_ky_gui * 3000;

        const rows = await this.db
          .collection('telemetry')
          .find({
            ma_thiet_bi: device._id,
            thoi_gian_do: {
              $gte: new Date(start - gap),
              $lte: new Date(end + gap),
            },
          })
          .sort({ thoi_gian_do: 1 })
          .toArray();

        const stats = energyBetween(rows, start, end, gap);

        await this.db.collection('hourly').updateOne(
          {
            ma_thiet_bi: device._id,
            hour: task.hour,
          },
          {
            $set: {
              ...stats,
              buildingId: device.buildingId,
              ma_phong: device.ma_phong,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );

        // Chỉ xóa nếu không có mẫu mới làm thay đổi revision.
        await this.db.collection('dirty_hours').deleteOne({
          _id: task._id,
          revision: task.revision,
        });
      }
    } finally {
      this.busy = false;
    }
  }

  // Kiểm tra tính hợp lệ và giới hạn của khoảng thời gian.
  range(from: string, to: string, maxDays = 31) {
    const a = new Date(from);
    const b = new Date(to);
    const maxDuration = maxDays * 86_400_000;

    if (
      !Number.isFinite(+a) ||
      !Number.isFinite(+b) ||
      a >= b ||
      +b - +a > maxDuration
    ) {
      throw new BadRequestException(
        `Khoảng thời gian phải tăng dần và tối đa ${maxDays} ngày`,
      );
    }

    return { a, b };
  }

  // Lấy lịch sử mẫu đo, phân trang bằng thời gian đo.
  async history(
    id: string,
    from: string,
    to: string,
    user: User,
    cursor?: string,
  ) {
    await this.catalog.get('devices', id, user);

    const { a, b } = this.range(from, to);

    const query: any = {
      ma_thiet_bi: id,
      thoi_gian_do: {
        $gte: a,
        $lt: b,
      },
    };

    if (cursor) {
      const cursorDate = new Date(cursor);

      if (
        !Number.isFinite(+cursorDate) ||
        cursorDate < a ||
        cursorDate >= b
      ) {
        throw new BadRequestException('Cursor không hợp lệ');
      }

      query.thoi_gian_do = {
        $gt: cursorDate,
        $lt: b,
      };
    }

    const rows = await this.db
      .collection('telemetry')
      .find(query, {
        projection: {
          _id: 0,
          processed: 0,
        },
      })
      .sort({ thoi_gian_do: 1 })
      .limit(1001)
      .toArray();

    const more = rows.length > 1000;
    const data = rows.slice(0, 1000);

    return {
      data,
      nextCursor: more
        ? data.at(-1)?.thoi_gian_do.toISOString()
        : null,
    };
  }

  // Tổng hợp điện năng theo ngày, tuần hoặc tháng.
  async energy(
    from: string,
    to: string,
    period: string,
    user: User,
    buildingId?: string,
    roomId?: string,
  ) {
    const { a, b } = this.range(from, to, 366);

    if (!['day', 'week', 'month'].includes(period)) {
      throw new BadRequestException(
        'period phải là day/week/month',
      );
    }

    // Dữ liệu tổng hợp theo giờ yêu cầu hai mốc thời gian tròn giờ.
    if (+a % HOUR || +b % HOUR) {
      throw new BadRequestException(
        'Mốc from/to phải tròn giờ; khoảng thời gian dạng [from,to)',
      );
    }

    const query: any = {
      ...this.security.buildingFilter(user),
      hour: {
        $gte: a,
        $lt: b,
      },
    };

    if (buildingId) {
      this.security.checkBuilding(user, buildingId);
      query.buildingId = buildingId;
    }

    if (roomId) {
      await this.catalog.get('rooms', roomId, user);
      query.ma_phong = roomId;
    }

    const results = await this.db
      .collection('hourly')
      .aggregate([
        {
          $match: query,
        },
        {
          $group: {
            _id: {
              $dateTrunc: {
                date: '$hour',
                unit: period,
                timezone: 'Asia/Ho_Chi_Minh',
                ...(period === 'week'
                  ? { startOfWeek: 'monday' }
                  : {}),
              },
            },
            dien_nang_kwh: {
              $sum: '$kwh',
            },
            thoi_gian_co_du_lieu_ms: {
              $sum: '$coveredMs',
            },
          },
        },
        {
          $sort: {
            _id: 1,
          },
        },
      ])
      .toArray();

    return {
      data: results,
      unit: 'kWh',
      timezone: 'Asia/Ho_Chi_Minh',
      method:
        'Tích phân hình thang; bỏ khoảng trống > 3 chu kỳ; tổng hợp theo giờ',
      pendingBuckets: await this.db
        .collection('dirty_hours')
        .countDocuments(),
    };
  }

  // Tổng hợp trạng thái thiết bị và mức tải của từng phòng.
  async dashboard(user: User) {
    const devices = await this.catalog.list('devices', user);
    const rooms = await this.catalog.list('rooms', user);
    const now = Date.now();

    const heatmap = rooms.map((room) => {
      const roomDevices = devices.filter(
        (device) => device.ma_phong === room._id,
      );

      const onlineDevices = roomDevices.filter((device) =>
        isOnline(device, now),
      );

      const power = onlineDevices.reduce(
        (total, device) =>
          total + (device.latest?.cong_suat_w || 0),
        0,
      );

      const ratedPower = roomDevices.reduce(
        (total, device) => total + device.cong_suat_dinh_muc,
        0,
      );

      let warningLevel: string;

      if (onlineDevices.length === 0) {
        warningLevel = 'NO_DATA';
      } else if (power > ratedPower * 0.8) {
        warningLevel = 'HIGH';
      } else if (power > ratedPower * 0.5) {
        warningLevel = 'MEDIUM';
      } else {
        warningLevel = 'LOW';
      }

      return {
        ma_phong: room._id,
        ten_phong: room.ten_phong,
        ma_tang: room.ma_tang,
        buildingId: room.buildingId,
        tong_cong_suat_w: power,
        online: onlineDevices.length,
        total: roomDevices.length,
        muc_do_canh_bao: warningLevel,
      };
    });

    return {
      devices,
      heatmap,
      totalPowerW: heatmap.reduce(
        (total, room) => total + room.tong_cong_suat_w,
        0,
      ),
      online: devices.filter((device) => device.online).length,
      total: devices.length,
      serverTime: new Date(),
    };
  }
}