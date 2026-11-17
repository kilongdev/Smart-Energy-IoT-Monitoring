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
