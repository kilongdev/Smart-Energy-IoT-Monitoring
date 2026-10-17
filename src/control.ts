import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { Catalog } from './catalog';
import { Database } from './database';
import {
  Action,
  isOnline,
  User,
} from './domain';
import { Events } from './events';
import { Mqtt } from './mqtt';
import { Security } from './security';
import { AckDto } from './dto';

@Injectable()
export class Control
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private busy = false;

  private readonly log = new Logger(Control.name);

  constructor(
    private readonly db: Database,
    private readonly catalog: Catalog,
    private readonly mqtt: Mqtt,
    private readonly events: Events,
    private readonly security: Security,
  ) {
    mqtt.ackHandler = (dto, topic) => this.ack(dto, topic);
  }

  async onApplicationBootstrap() {
    // Persisted pending commands survive process restarts and expire using their original deadline.
    this.timer = setInterval(() => {
      this.expire().catch((error) => {
        this.log.error(error.message);
      });
    }, 250);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async send(
    id: string,
    action: Action,
    user: User | null,
    schedule?: { id: string; runId: string },
  ) {
    const device = await this.catalog.get(
      'devices',
      id,
      user || undefined,
    );

    const now = new Date();
    const commandId = randomUUID();

    const command: any = {
      _id: commandId,
      ma_lenh: commandId,
      ma_lich_su: commandId,
      ma_thiet_bi: id,
      buildingId: device.buildingId,
      ma_nguoi_dung: user?._id || null,
      hanh_dong: action,
      nguon: schedule ? 'Hẹn giờ' : 'Thủ công',
      ma_lich_trinh: schedule?.id || null,
      runId: schedule?.runId || null,
      trang_thai: 'Đang chờ',
      thoi_gian_thuc_hien: now,
      deadline: new Date(+now + 5000),
    };

    await this.db.collection('commands').insertOne(command);

    if (!device.cho_phep_dieu_khien) {
      return this.fail(command, 'Thiết bị không hỗ trợ điều khiển');
    }

    if (!isOnline(device)) {
      return this.fail(command, 'Thiết bị offline');
    }

    if (!this.mqtt.connected) {
      return this.fail(command, 'MQTT chưa kết nối');
    }

    const locked = await this.db.collection('devices').findOneAndUpdate(
      {
        _id: id,
        $or: [
          { pendingCommand: null },
          { pendingCommand: { $exists: false } },
        ],
      },
      {
        $set: {
          pendingCommand: commandId,
          latestCommandId: commandId,
        },
      },
      { returnDocument: 'after' },
    );

    if (!locked) {
      return this.fail(command, 'Thiết bị đang xử lý một lệnh khác');
    }

    // Do not block HTTP until ACK. State changes arrive via authenticated WebSocket.
    this.mqtt
      .publish(`${device.chu_de_mqtt}/command`, {
        ma_lenh: commandId,
        ma_thiet_bi: id,
        hanh_dong: action,
        het_han: command.deadline.toISOString(),
      })
      .then(async () => {
        await this.db.collection('commands').updateOne(
          {
            _id: commandId,
            trang_thai: 'Đang chờ',
          },
          {
            $set: {
              trang_thai: 'Đã gửi',
              sentAt: new Date(),
            },
          },
        );
      })
      .catch((error) =>
        this.fail(command, error.message).catch((cause) => {
          this.log.error(cause.message);
        }),
      );

    return command;
  }

  private async fail(command: any, reason: string) {
    const result = await this.db.collection('commands').findOneAndUpdate(
      {
        _id: command._id,
        trang_thai: {
          $in: ['Đang chờ', 'Đã gửi'],
        },
      },
      {
        $set: {
          trang_thai: 'Thất bại',
          loi: reason,
          completedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );

    await this.db.collection('devices').updateOne(
      {
        _id: command.ma_thiet_bi,
        pendingCommand: command._id,
      },
      {
        $set: { pendingCommand: null },
      },
    );

    if (result) {
      this.events.send(
        command.buildingId,
        'command',
        result,
        true,
      );
    }

    return result || command;
  }

  async ack(dto: AckDto, topic: string) {
    const device = await this.catalog.get(
      'devices',
      dto.ma_thiet_bi,
    );

    if (topic !== `${device.chu_de_mqtt}/ack`) {
      await this.db.audit('INVALID_ACK', {
        reason: 'Topic không khớp',
      });

      return;
    }

    const command = await this.db.collection('commands').findOne({
      _id: dto.ma_lenh,
      ma_thiet_bi: device._id,
    });

    if (!command) {
      await this.db.audit('INVALID_ACK', {
        reason: 'Không có lệnh tương ứng',
        command: dto.ma_lenh,
      });

      return;
    }

    const time = new Date(dto.thoi_gian);
    const now = new Date();

    if (
      +time > +now + 5000 ||
      +time < +command.thoi_gian_thuc_hien - 1000
    ) {
      await this.db.audit('INVALID_ACK', {
        reason: 'Thời điểm ACK không hợp lệ',
      });

      return;
    }

    if (+now > +command.deadline) {
      await this.fail(command, 'Hết 5 giây chờ ACK');

      await this.db.collection('commands').updateOne(
        { _id: command._id },
        {
          $set: { lateAck: dto },
        },
      );
    } else {
      const relayMatches =
        dto.trang_thai_relay === (command.hanh_dong === 'Bật');

      const result = await this.db
        .collection('commands')
        .findOneAndUpdate(
          {
            _id: command._id,
            trang_thai: {
              $in: ['Đang chờ', 'Đã gửi'],
            },
          },
          {
            $set: {
              trang_thai:
                !dto.loi && relayMatches
                  ? 'Thành công'
                  : 'Thất bại',
              loi:
                dto.loi ||
                (relayMatches ? '' : 'Relay không khớp'),
              ack: dto,
              completedAt: now,
            },
          },
          { returnDocument: 'after' },
        );

      if (result) {
        this.events.send(
          device.buildingId,
          'command',
          result,
          true,
        );
      }
    }

    // Old ACK cannot overwrite the state of a more recently requested command or measurement.
    await this.db.collection('devices').updateOne(
      {
        _id: device._id,
        latestCommandId: command._id,
        $or: [
          { lastRelayAt: { $lte: time } },
          { lastRelayAt: { $exists: false } },
        ],
      },
      {
        $set: {
          trang_thai_relay: dto.trang_thai_relay,
          lastRelayAt: time,
          lastSeen: now,
        },
      },
    );

    await this.db.collection('devices').updateOne(
      {
        _id: device._id,
        pendingCommand: command._id,
      },
      {
        $set: { pendingCommand: null },
      },
    );
  }

  async logs(user: User) {
    return this.db
      .collection('commands')
      .find(this.security.buildingFilter(user))
      .sort({ thoi_gian_thuc_hien: -1 })
      .limit(500)
      .toArray();
  }

  async expire() {
    if (this.busy) {
      return;
    }

    this.busy = true;

    try {
      const rows = await this.db
        .collection('commands')
        .find({
          trang_thai: {
            $in: ['Đang chờ', 'Đã gửi'],
          },
          deadline: {
            $lte: new Date(),
          },
        })
        .limit(200)
        .toArray();

      for (const command of rows) {
        await this.fail(command, 'Hết 5 giây chờ ACK');
      }
    } finally {
      this.busy = false;
    }
  }
}