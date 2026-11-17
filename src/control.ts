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
      this.expire()
        .catch((error) => {
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
      deadline: new Date(+now + 10000),
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
        this.fail(command, error.message, true).catch((cause) => {
          this.log.error(cause.message);
        }),
      );

    return command;
  }

  private async fail(command: any, reason: string, uncertain = false) {
    const result = await this.db.collection('commands').findOneAndUpdate(
      {
        _id: command._id,
        trang_thai: {
          $in: ['Đang chờ', 'Đã gửi'],
        },
      },
      {
        $set: {
          trang_thai: uncertain ? 'Chưa xác định' : 'Thất bại',
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

    if (!Number.isFinite(+time)) {
      await this.db.audit('INVALID_ACK', {
        reason: 'Thời điểm ACK không hợp lệ',
      });

      return;
    }

    // Correlate by device, topic and command UUID, not the ESP clock.
    // Keep its timestamp in ack for diagnosis; order current state by server receipt.
    const stateTime = now;

    let completed: any;
    {
      const relayMatches =
        dto.trang_thai_relay === (command.hanh_dong === 'Bật');

      const result = await this.db
        .collection('commands')
        .findOneAndUpdate(
          {
            _id: command._id,
            trang_thai: {
              $in: ['Đang chờ', 'Đã gửi', 'Chưa xác định'],
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
              ...(+now > +command.deadline ? { lateAck: dto } : {}),
              confirmedBy: 'ack',
              ackReceivedAt: now,
              ackClockSkewMs: +time - +now,
              completedAt: now,
            },
          },
          { returnDocument: 'after' },
        );

      completed = result;
    }

    // Duplicate ACKs must not overwrite telemetry or produce another popup.
    if (!completed) return;
    // Tắt thành công: hạ công suất trong devices.latest ngay tại DB để
    // mọi lần load() dashboard sau đó thấy 0 tức thì, không chờ telemetry
    // kỳ sau (vốn còn kẹt sau hàng đợi ingest ~30s). Telemetry thật kỳ sau
    // có thoi_gian_do mới hơn vẫn ghi đè bình thường qua Telemetry.process.
    const relayOffSuccess =
      completed.trang_thai === 'Thành công' &&
      command.hanh_dong === 'Tắt' &&
      dto.trang_thai_relay === false;
    // Bật thành công: công suất thật còn kẹt sau hàng đợi ingest ~30s nên
    // DB vẫn giữ số 0 cũ tới 10s+. Lấy mẫu dương gần nhất làm ước lượng để
    // dashboard thấy tải ngay; telemetry thật kỳ sau ghi đè lại.
    const relayOnSuccess =
      completed.trang_thai === 'Thành công' &&
      command.hanh_dong === 'Bật' &&
      dto.trang_thai_relay === true;
    let powerEstimate: any = null;
    if (relayOnSuccess) {
      // Không query telemetry ở đây: collection telemetry giữ 30 ngày và
      // chưa có index theo ma_thiet_bi nên find().sort() quét rất lâu
      // (tới hàng chục giây), làm chậm chính ACK đang cần trả nhanh.
      // Dùng ước lượng tức thì từ công suất định mức; telemetry thật
      // kỳ sau (thiết bị ảo đã publish ngay khi đổi relay) sẽ ghi đè
      // lại số chính xác.
      const rated = Number(device.cong_suat_dinh_muc) || 2000;
      const guess = Math.round(Math.min(900, Math.max(300, rated * 0.25)) * 10) / 10;
      powerEstimate = {
        cong_suat_w: guess,
        dong_dien_a: Math.round(((guess / 220) * 100)) / 100,
        dien_ap_v: 220,
      };
      (completed as any).powerEstimate = powerEstimate;
    }
    // Old ACK cannot overwrite the state of a more recently requested command or measurement.
    await this.db.collection('devices').updateOne(
      {
        _id: device._id,
        latestCommandId: command._id,
        $or: [
          { lastRelayAt: { $lte: stateTime } },
          { lastRelayAt: { $exists: false } },
        ],
      },
      {
        $set: {
          trang_thai_relay: dto.trang_thai_relay,
          lastRelayAt: stateTime,
          lastSeen: now,
          // Chặn telemetry cũ còn kẹt trong hàng đợi ingest (~30s+) ghi đè
          // ước lượng mới: nâng mốc thời gian latest lên lúc ACK để các bản
          // tin đo trước đó bị coi là cũ và bỏ qua. Telemetry kỳ sau có
          // thoi_gian_do mới hơn vẫn ghi đè bình thường.
          ...(relayOffSuccess || powerEstimate
            ? {
                'latest.thoi_gian_do': now,
                'latest.receivedAt': now,
              }
            : {}),
          ...(relayOffSuccess
            ? {
                'latest.cong_suat_w': 0,
                'latest.dong_dien_a': 0,
              }
            : {}),
          ...(powerEstimate
            ? {
                'latest.cong_suat_w': powerEstimate.cong_suat_w,
                'latest.dong_dien_a': powerEstimate.dong_dien_a,
                'latest.dien_ap_v': powerEstimate.dien_ap_v,
              }
            : {}),
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
    if (completed) this.events.send(device.buildingId, 'command', completed, true);
  }

  async result(id: string, user: User) {
    return this.db.collection('commands').findOne({
      _id: id, ...this.security.buildingFilter(user),
    });
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
        await this.fail(command, 'Sau 10 giây chưa nhận được ACK; chưa thể kết luận thiết bị đã thực hiện hay chưa.', true);
      }
    } finally {
      this.busy = false;
    }
  }

}
