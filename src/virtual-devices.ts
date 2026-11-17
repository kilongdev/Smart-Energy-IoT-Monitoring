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
  // Giữ giá trị mượt giữa các kỳ để công suất không nhảy loạn.
  power: number;
  voltage: number;
  temp: number;
  // Cấu hình tải na ná sketch Wokwi (den/quat/2xML/may_chieu + ổ cắm).
  usage: number;
  loadOn: boolean[];
  acOffset1: number;
  acOffset2: number;
};

// Dàn tải chuẩn Wokwi – dùng chung cho cả 15 máy giả lập.
// den 360W, quat 240W, 2x máy lạnh 1100W (chạy 30s/nghỉ 10s), máy chiếu 250W,
// tải thường trực 40W + ổ cắm 0–500W theo núm vặn.
const WOKWI_LOADS = [
  { watts: 360, cycling: false },
  { watts: 240, cycling: false },
  { watts: 1100, cycling: true },
  { watts: 1100, cycling: true },
  { watts: 250, cycling: false },
];
const WOKWI_ESSENTIAL_W = 40;
const WOKWI_RATED_W = 4000;

function wokwiLoadPower(loadIdx: number, now: number, offset: number, noise: number) {
  const load = WOKWI_LOADS[loadIdx];
  if (!load.cycling) return load.watts * noise;
  const phase = (now + offset) % 40000;
  return (phase < 30000 ? load.watts : load.watts * 0.12) * noise;
}

// Làm mượt na ná sketch Wokwi: dàn tải den 360 + quat 240 + 2xML 1100
// (chạy 30s/nghỉ 10s) + máy chiếu 250 + thường trực 40 + ổ cắm 0–500W.
// Nhiễu ±3% như `random(-30,31)/1000` trên ESP nên đường êm hơn hẳn.
function smoothSample(state: VirtualState, periodSec: number, now: number) {
    if (!state.relay) {
    const power = state.power > 1 ? Math.round(state.power * 0.3 * 10) / 10 : 0;
    state.power = power;
    return {
      power,
      voltage: Math.round((state.voltage + (220 - state.voltage) * 0.3) * 10) / 10,
      current: 0,
      temperature: Math.round((state.temp + (27 - state.temp) * 0.2) * 10) / 10,
      leak: 0.5,
      enabledLoads: 0,
      details: null as any,
    };
  }
  const noise = 1 + (Math.random() - 0.5) * 0.06;
  const offsets = [0, 0, state.acOffset1, state.acOffset2, 0];
  let switched = 0;
  let enabledLoads = 0;
  const details: number[] = [];
  for (let i = 0; i < WOKWI_LOADS.length; i++) {
    let v = 0;
    if (state.loadOn[i]) {
      v = wokwiLoadPower(i, now, offsets[i], noise);
      enabledLoads++;
    }
    details.push(Math.round(v * 10) / 10);
    switched += v;
  }
  const oCam = 500 * state.usage * noise;
  details.push(Math.round(oCam * 10) / 10);
  switched += oCam;
  const rawTarget = WOKWI_ESSENTIAL_W * noise + switched;
  // Trôi 60% về target mỗi kỳ: giữ nhiễu ±3% của Wokwi nhưng không giật cục.
  let power = state.power + (rawTarget - state.power) * 0.6;
  power = Math.round(power * 10) / 10;
  state.power = power;
  // Drift nhẹ núm vặn ổ cắm để mỗi phòng có cá tính riêng.
  state.usage = Math.min(0.95, Math.max(0.05, state.usage + (Math.random() - 0.5) * 0.02));
  const rawVoltage = 220 + (Math.random() - 0.5) * 4;
  const voltage = Math.round((state.voltage + (rawVoltage - state.voltage) * 0.5) * 10) / 10;
  state.voltage = voltage;
  const tempTarget = 29 + (power / WOKWI_RATED_W) * 4;
  const temperature = Math.round((state.temp + (tempTarget - state.temp) * 0.3 + (Math.random() - 0.5) * 0.2) * 10) / 10;
  state.temp = temperature;
  const current = Math.round(((power / (voltage * 0.95) || 0) * 100)) / 100;
  state.energy += (power * periodSec) / 3_600_000;
  if (state.energy > 9999) state.energy = 0.5;
  return {
    power,
    voltage,
    current,
    temperature,
    leak: Math.round((30 + Math.random() * 50) / 10) / 10,
    enabledLoads,
    details,
  };
}

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

      // Mỗi phòng có "cá tính" riêng như núm vặn + công tắc trên Wokwi:
      // ổ cắm 5–95%, 3–5 tải bật, 2 máy lạnh lệch pha 17s.
      const idx = index + 1;
      const loadOn = kept?.loadOn ?? [
        true,
        (idx * 7) % 10 < 7,
        (idx * 3) % 10 < 8,
        (idx * 5 + 3) % 10 < 6,
        (idx * 11) % 10 < 5,
      ];
      const usage = kept?.usage ?? 0.15 + ((idx * 37) % 70) / 100;
      const seedBase = kept?.power ?? 1500 + ((idx * 211) % 1500);
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
        index: index + 1,
        acks: kept?.acks || new Map(),
        // Khởi tạo quanh dàn tải Wokwi để kỳ đầu không nhảy từ 0.
        power: kept?.power ?? seedBase,
        voltage: kept?.voltage ?? 220,
        temp: kept?.temp ?? 29,
        usage,
        loadOn,
        acOffset1: kept?.acOffset1 ?? 0,
        acOffset2: kept?.acOffset2 ?? 17000,
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

    // Gửi ngay 1 bản telemetry sau khi đổi relay để dashboard thấy công
    // suất về 0 (Tắt) / có tải (Bật) trong ~0.5s thay vì chờ hết chu_ky_gui.
    // Tick định kỳ vẫn giữ nguyên; reset state.last để không publish trùng.
    try {
      const now = Date.now();
      const smoothed = smoothSample(state, 0.5, now);
      const power = state.relay ? smoothed.power : 0;
      const voltage = smoothed.voltage;
      const current = state.relay ? smoothed.current : 0;
      const temperature = smoothed.temperature;
      const leak = smoothed.leak;
      const detailArr = Array.isArray(smoothed.details) ? smoothed.details : [];
      this.client?.publish(
        `${state.topic}/telemetry`,
        JSON.stringify({
          ma_thiet_bi: state.id,
          ma_phong: state.roomCode,
          thoi_gian_do: new Date(now).toISOString(),
          uptime_s: Math.floor((now - this.startedAt) / 1000),
          cong_suat_w: power,
          dien_ap_v: voltage,
          dong_dien_a: current,
          nhiet_do_c: temperature,
          dong_ro_ma: leak,
          dien_nang_kwh: Math.round(state.energy * 10000) / 10000,
          trang_thai_relay: state.relay,
          dinh_muc_w: WOKWI_RATED_W,
          che_do_gia_lap: 'binh_thuong',
          so_thiet_bi_bat: smoothed.enabledLoads ?? 0,
          chi_tiet_mo_phong: {
            den: detailArr[0] ?? 0,
            quat: detailArr[1] ?? 0,
            may_lanh_1: detailArr[2] ?? 0,
            may_lanh_2: detailArr[3] ?? 0,
            may_chieu: detailArr[4] ?? 0,
            o_cam: detailArr[5] ?? 0,
          },
        }),
        { qos: 1 },
      );
      state.last = now;
    } catch {}

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
          // Na ná Wokwi: cùng dàn tải, cùng nhiễu ±3%, trôi 60% về target.
          const smoothed = smoothSample(state, state.period, now);
          const power = smoothed.power;
          const voltage = smoothed.voltage;
          const current = smoothed.current;
          const temperature = smoothed.temperature;
          const leak = smoothed.leak;
          const detailArr = Array.isArray(smoothed.details) ? smoothed.details : [];

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
            dinh_muc_w: WOKWI_RATED_W,
            che_do_gia_lap: 'binh_thuong',
            so_thiet_bi_bat: smoothed.enabledLoads ?? 0,
            chi_tiet_mo_phong: {
              den: detailArr[0] ?? 0,
              quat: detailArr[1] ?? 0,
              may_lanh_1: detailArr[2] ?? 0,
              may_lanh_2: detailArr[3] ?? 0,
              may_chieu: detailArr[4] ?? 0,
              o_cam: detailArr[5] ?? 0,
            },
          };

          await this.client!.publishAsync(
            `${state.topic}/telemetry`,
            JSON.stringify(payload),
            // Telemetry fleet dùng QoS 0: Wokwi thật cũng publish QoS 0,
            // giảm 1/2 tải PUBACK trên EMQX free-tier để nhường slot cho
            // ACK lệnh Bật/Tắt (vẫn QoS 1) của Wokwi về trong 1-2s.
            { qos: 0 },
          );

          // Giữ rải pha: last = now + jitter 0-500ms thay vì cùng 1 mốc,
          // nếu không 15 gateway sẽ đồng bộ và dồn 15 insert Atlas cùng
          // lúc mỗi chu kỳ, chặn event-loop và làm chậm đường Wokwi.
          state.last = Date.now() + Math.floor(Math.random() * 500);
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
