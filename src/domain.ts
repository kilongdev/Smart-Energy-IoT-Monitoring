export type Role = 'Admin' | 'QuanLy' | 'NguoiXem';
export type Action = 'Bật' | 'Tắt';

export interface User {
  _id: string;
  tai_khoan: string;
  ho_ten: string;
  mat_khau: string;
  vai_tro: Role;
  active: boolean;
  buildingIds: string[];
}

export const IDS = {
  building: '11111111-1111-4111-8111-111111111111',
  floor: '22222222-2222-4222-8222-222222222222',
  room: '33333333-3333-4333-8333-333333333333',
  device: '44444444-4444-4444-8444-444444444444',
};

export const HOUR = 3_600_000;

export function hourStart(date: Date) {
  return new Date(Math.floor(date.getTime() / HOUR) * HOUR);
}

export function localClock(
  date: Date,
  zone = 'Asia/Ho_Chi_Minh',
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  const days: Record<string, string> = {
    Mon: 'T2',
    Tue: 'T3',
    Wed: 'T4',
    Thu: 'T5',
    Fri: 'T6',
    Sat: 'T7',
    Sun: 'CN',
  };

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
    day: days[values.weekday],
  };
}

export function inWindow(
  date: Date,
  window?: string,
  zone?: string,
) {
  if (!window) {
    return true;
  }

  const [start, end] = window.split('-');
  const time = localClock(date, zone).time.slice(0, 5);

  return (
    start === end ||
    (start < end
      ? time >= start && time < end
      : time >= start || time < end)
  );
}

export function compare(
  value: number,
  operator: string,
  threshold: number,
) {
  const comparisons: Record<string, boolean> = {
    '>': value > threshold,
    '<': value < threshold,
    '>=': value >= threshold,
    '<=': value <= threshold,
    '=': value === threshold,
  };

  return comparisons[operator] ?? false;
}

export function isOnline(device: any, now = Date.now()) {
  return (
    !!device.lastSeen &&
    now - new Date(device.lastSeen).getTime() <=
      device.chu_ky_gui * 3000
  );
}

export function energyBetween(
  samples: any[],
  start: number,
  end: number,
  maxGap: number,
) {
  let kwh = 0;
  let coveredMs = 0;

  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];

    const t0 = +new Date(previous.thoi_gian_do);
    const t1 = +new Date(current.thoi_gian_do);
    const duration = t1 - t0;

    if (duration <= 0 || duration > maxGap) {
      continue;
    }

    const left = Math.max(start, t0);
    const right = Math.min(end, t1);

    if (right <= left) {
      continue;
    }

    const powerAtLeft =
      previous.cong_suat_w +
      ((current.cong_suat_w - previous.cong_suat_w) *
        (left - t0)) /
        duration;

    const powerAtRight =
      previous.cong_suat_w +
      ((current.cong_suat_w - previous.cong_suat_w) *
        (right - t0)) /
        duration;

    kwh +=
      ((powerAtLeft + powerAtRight) / 2) *
      ((right - left) / 3_600_000_000);

    coveredMs += right - left;
  }

  return { kwh, coveredMs };
}

export function publicUser(user: any) {
  const { mat_khau, ...publicData } = user;

  return {
    ...publicData,
    ma_nguoi_dung: user._id,
  };
}

export function defined(dto: any) {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  );
}