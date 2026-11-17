import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import mqtt, { MqttClient } from 'mqtt';

import { Database } from './database';

// Mô phỏng 15 gateway còn lại ngay trong tiến trình Nest.
// Backend không phân biệt ESP thật hay giả lập: cả hai đều đi qua
// cùng một broker EMQX, cùng topic `${chu_de_mqtt}/telemetry|command|ack`
// và cùng DTO validation. A101/B101 giữ nguyên (ESP thật trên Wokwi)
// nên mặc định loại trừ 2 id đó qua SIM_VIRTUAL_EXCLUDE.
type VirtualState = {
  id: string;
  topic: string;
  roomCode: string;
  dinhMuc: number;
  period: number;
  last: number;
  relay: boolean;
  energy: number;
  index: number;
  acks: Map<string, any>;
};

const DEFAULT_EXCLUDE = [
  '44444444-4444-4444-8444-444444444444', // A101 (Wokwi)
  'e5a539e0-b1c2-498c-8153-5349795974fd', // B101 (Wokwi)
].join(',');

@Injectable()
export class VirtualDevices
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private client?: MqttClient;
  private timer?: NodeJS.Timeout;
  private refresher?: NodeJS.Timeout;
  private busy = false;
  private readonly devices = new Map<string, VirtualState>();
  private readonly startedAt = Date.now();
  private readonly log = new Logger(VirtualDevices.name);

  constructor(private readonly db: Database) {}

  async onApplicationBootstrap() {
    if (process.env.SIM_VIRTUAL !== 'true') {
      return;
    }

    if (!process.env.MQTT_URL) {
      this.log.warn('SIM_VIRTUAL bật nhưng thiếu MQTT_URL nên bỏ qua.');
      return;
    }

    await this.loadDevices();

    if (!this.devices.size) {
      this.log.warn('SIM_VIRTUAL không tìm thấy thiết bị nào để mô phỏng.');
      return;
    }

    this.client = mqtt.connect(process.env.MQTT_URL, {
      clientId: `smart-energy-virtual-fleet-${process.pid}`,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 5000,
    });

    this.client.on('connect', () => {
      // Một kết nối duy nhất cho cả fleet (nhẹ hơn 15 kết nối riêng
      // trên EMQX Cloud free-tier). Dùng wildcard để tự bao phủ
      // campus/devices/*; handler sẽ lọc theo danh sách mô phỏng.
      this.client!.subscribe('campus/devices/+/command', { qos: 1 });
      this.client!.subscribe('campus/devices/+/config', { qos: 1 });
      this.log.log(
        `Giả lập ${this.devices.size} gateway (trừ A101/B101 thật).`,
      );
    });

    this.client.on('error', (error) => {
      this.log.warn('Virtual MQTT: ' + error.message);
    });

    this.client.on('message', (topic, bytes) => {
      try {
        this.handle(topic, bytes);
      } catch (error: any) {
        this.log.warn(error.message);
      }
    });

    // Tick 500ms, mỗi gateway tự giữ chu_ky_gui riêng (mặc định 2s).
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.log.warn(error.message));
    }, 500);

    // Tải lại danh sách + chu kỳ 30s để bắt thiết bị mới/sửa chu_ky_gui.
    this.refresher = setInterval(() => {
      this.loadDevices().catch((error) => this.log.warn(error.message));
    }, 30_000);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    clearInterval(this.refresher);
    await this.client?.endAsync(true);
  }

  private async loadDevices() {
    const exclude = new Set(
      (process.env.SIM_VIRTUAL_EXCLUDE || DEFAULT_EXCLUDE)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );

    const [rows, rooms] = await Promise.all([
      this.db.collection('devices').find({}).toArray(),
      this.db.collection('rooms').find({}).toArray(),
    ]);

    const roomCode = new Map(
      rooms.map((room: any) => [
        room._id,
        String(room.ten_phong || '').replace(/^Phòng\s+/, '') || 'UNKNOWN',
      ]),
    );

    let index = 0;
    const seen = new Set<string>();

    for (const row of rows) {
      if (exclude.has(row._id)) continue;

      const topic = String(row.chu_de_mqtt || '');
      if (!topic.startsWith('campus/')) continue;

      seen.add(topic);
      index += 1;

      const period =
        Number.isInteger(row.chu_ky_gui) &&
        row.chu_ky_gui >= 1 &&
        row.chu_ky_gui <= 60
          ? row.chu_ky_gui
          : 2;

      const kept = this.devices.get(topic);

      this.devices.set(topic, {
        id: row._id,
        topic,
        roomCode:
          roomCode.get(row.ma_phong) ||
          String(row.ten_thiet_bi || '').replace(/^Gateway phòng\s+/, '') ||
          'UNKNOWN',
        dinhMuc: row.cong_suat_dinh_muc || 4000,
        period,
        // Rải pha publish lần đầu trong 1 chu kỳ để 15 gateway không dồn
        // cùng 1 tick gây nghẽn đánh giá trên Atlas. Thiết bị giữ lại
        // giữ nguyên tiến độ; chỉ thiết bị mới random pha.
        last: kept?.last ?? Date.now() - Math.floor(Math.random() * period * 1000),
        relay: kept ? kept.relay : true,
        energy: kept ? kept.energy : 0.5 + Math.random() * 1.5,
        index,
        acks: kept?.acks || new Map(),
      });
    }

    for (const topic of [...this.devices.keys()]) {
      if (!seen.has(topic)) this.devices.delete(topic);
    }
  }

  private handle(topic: string, bytes: Buffer) {
    const base = topic.endsWith('/command')
      ? topic.slice(0, -'/command'.length)
      : topic.endsWith('/config')
        ? topic.slice(0, -'/config'.length)
        : null;

    if (!base) return;

    const state = this.devices.get(base);
    if (!state || !this.client?.connected) return;

    const payload = JSON.parse(bytes.toString());

    // Backend gửi retained config { chu_ky_gui } khi khởi động và khi
    // sửa thiết bị -> gateway thật/giả lập đều phải tôn trọng.
    if (topic.endsWith('/config')) {
      if (
        Number.isInteger(payload.chu_ky_gui) &&
        payload.chu_ky_gui >= 1 &&
        payload.chu_ky_gui <= 60
      ) {
        state.period = payload.chu_ky_gui;
      }
      return;
    }

    if (payload.ma_thiet_bi !== state.id) return;

    // Trả lại ACK đã gửi nếu broker redeliver (QoS 1) -> giống simulator.mjs.
    if (state.acks.has(payload.ma_lenh)) {
      this.client.publish(
        `${state.topic}/ack`,
        JSON.stringify(state.acks.get(payload.ma_lenh)),
        { qos: 1 },
      );
      return;
    }

    if (
      Date.parse(payload.het_han) < Date.now() ||
      !['Bật', 'Tắt'].includes(payload.hanh_dong)
    ) {
      return;
    }

    const mode = process.env.SIM_ACK_MODE || 'normal';
    state.relay = payload.hanh_dong === 'Bật';

    if (mode === 'drop') return;

    const ack = {
      ma_lenh:
        mode === 'wrong-id'
          ? '00000000-0000-4000-8000-000000000000'
          : payload.ma_lenh,
      ma_thiet_bi: state.id,
      trang_thai_relay: mode === 'mismatch' ? !state.relay : state.relay,
      thoi_gian: new Date().toISOString(),
    };

    state.acks.set(payload.ma_lenh, ack);
    if (state.acks.size > 1000) {
      const oldest = state.acks.keys().next().value;
      if (oldest) state.acks.delete(oldest);
    }

    setTimeout(
      () => {
        this.client?.publish(`${state.topic}/ack`, JSON.stringify(ack), {
          qos: 1,
        });
      },
      mode === 'late' ? 11_500 : 150,
    );
  }

  private async tick() {
    if (!this.client?.connected || this.busy) return;

    this.busy = true;

    try {
      const now = Date.now();
      const due = [...this.devices.values()].filter(
        (state) => now - state.last >= state.period * 1000,
      );

      if (!due.length) return;

      const results = await Promise.allSettled(
        due.map(async (state) => {
          // Tải nền + nhiễu, tương tự sketch.ino nhưng gọn cho 15 phòng.
          const base = 420 + ((state.index * 53) % 480);
          const power = state.relay
            ? Math.round((base + Math.random() * 90) * 10) / 10
            : 0;
          const voltage = Math.round((219 + Math.random() * 3) * 10) / 10;
          const current =
            Math.round(((power / (voltage * 0.95) || 0) * 100)) / 100;
          const temperature =
            Math.round((state.relay ? 31 + (state.index % 5) : 27) + Math.random() * 10) / 10;
          const leak = Math.round((3 + Math.random() * 6) * 10) / 10;
          state.energy += (power * state.period) / 3_600_000;
          if (state.energy > 9999) state.energy = 0.5;

          const payload = {
            ma_thiet_bi: state.id,
            ma_phong: state.roomCode,
            thoi_gian_do: new Date().toISOString(),
            uptime_s: Math.floor((now - this.startedAt) / 1000),
            cong_suat_w: power,
            dien_ap_v: voltage,
            dong_dien_a: current,
            nhiet_do_c: temperature,
            dong_ro_ma: leak,
            dien_nang_kwh: Math.round(state.energy * 10000) / 10000,
            trang_thai_relay: state.relay,
            dinh_muc_w: state.dinhMuc,
            che_do_gia_lap: 'binh_thuong',
          };

          await this.client!.publishAsync(
            `${state.topic}/telemetry`,
            JSON.stringify(payload),
            { qos: 1 },
          );

          // Chỉ tính đã gửi khi publish thành công; thất bại giữ nguyên
          // để tick sau retry ngay thay vì trễ thêm cả chu kỳ.
          state.last = now;
        }),
      );

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.log.warn(
            `${due[index].roomCode}: publish thất bại: ${result.reason?.message || result.reason}`,
          );
        }
      });
    } finally {
      this.busy = false;
    }
  }
}
