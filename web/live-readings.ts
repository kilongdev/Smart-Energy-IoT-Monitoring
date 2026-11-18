type Row = Record<string, any>;
export function updateLiveReading(data: Row, sample: Row): Row {
  let changed: Row | undefined;
  const devices = data.devices.map((device: Row) => {
    if (device._id !== sample.ma_thiet_bi || !Number.isFinite(+new Date(sample.thoi_gian_do)) ||
      (device.latest?.thoi_gian_do && +new Date(sample.thoi_gian_do) <= +new Date(device.latest.thoi_gian_do))) return device;
    const fresh = Date.now() - +new Date(sample.receivedAt) <= (device.chu_ky_gui || 5) * 5000;
    changed = { ...device, latest: { ...device.latest, ...sample },
      ...(fresh ? { online: true, lastSeen: sample.receivedAt } : {}) };
    return changed;
  });
  if (!changed) return data;
  const gateway = changed;
  const heatmap = data.heatmap.map((room: Row) => room.gatewayId === gateway._id ? {
    ...room, tong_cong_suat_w: gateway.online ? gateway.latest.cong_suat_w : 0, online: gateway.online,
  } : room);
  return { ...data, devices, heatmap };
}
export function preserveNewerReadings(incoming: Row, current: Row): Row {
  return current.devices.reduce((result: Row, device: Row) => device.latest ?
    updateLiveReading(result, { ...device.latest, ma_thiet_bi: device._id }) : result, incoming);
}

// Optimistic sau ACK thanh cong: relay da chac chan, cong suat Tat ve 0
// ngay thay vi cho telemetry ky sau. Telemetry that ve sau se ghi de lai
// qua updateLiveReading nen khong so lech so lieu.
export function applyCommandOptimistic(data: Row, command: Row): Row {
  if (!command || command.trang_thai !== 'Thành công' || !command.ma_thiet_bi) return data;
  const relay = command.hanh_dong === 'Bật' ? true : command.hanh_dong === 'Tắt' ? false : undefined;
  if (relay === undefined) return data;
  const now = new Date().toISOString();
  const devices = data.devices.map((device: Row) => {
    if (device._id !== command.ma_thiet_bi) return device;
    const estimate = relay === true && command.powerEstimate ? command.powerEstimate : null;
    const latest = {
      ...(device.latest || {}),
      trang_thai_relay: relay,
      ...(relay === false ? { cong_suat_w: 0, dong_dien_a: 0 } : {}),
      ...(estimate && Number.isFinite(+estimate.cong_suat_w)
        ? {
            cong_suat_w: +estimate.cong_suat_w,
            ...(Number.isFinite(+estimate.dong_dien_a) ? { dong_dien_a: +estimate.dong_dien_a } : {}),
            ...(Number.isFinite(+estimate.dien_ap_v) ? { dien_ap_v: +estimate.dien_ap_v } : {}),
          }
        : {}),
      // Đặt mốc thời gian bằng lúc ACK để lần load() ngay sau đó
      // (preserveNewerReadings) không coi số liệu cũ trên server là mới
      // hơn và ghi đè số 0 optimistic trở lại thành công suất cũ.
      // Telemetry thật kỳ sau có thoi_gian_do mới hơn vẫn ghi đè bình thường.
      thoi_gian_do: now,
      receivedAt: now,
    };
    return { ...device, trang_thai_relay: relay, lastRelayAt: now, latest };
  });
  const changed = devices.find((device: Row) => device._id === command.ma_thiet_bi);
  if (!changed) return data;
  const heatmap = data.heatmap.map((room: Row) => room.gatewayId === changed._id ? {
    ...room, tong_cong_suat_w: changed.online ? (changed.latest?.cong_suat_w ?? 0) : 0, online: changed.online,
  } : room);
  return { ...data, devices, heatmap };
}
