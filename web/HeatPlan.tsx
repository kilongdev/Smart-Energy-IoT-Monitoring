import React, { useState } from 'react';
type Row = Record<string, any>;
export function HeatPlan({ rooms, floors, buildings, devices, alerts }: { rooms: Row[]; floors: Row[]; buildings: Row[]; devices: Row[]; alerts: Row[] }) {
  const [metric, setMetric] = useState('power');
  const [status, setStatus] = useState('');
  const [focus, setFocus] = useState('');
  const entries = rooms.map(r => {
    const ds = devices.filter(d => d.ma_phong === r.ma_phong);
    const rated = ds.reduce((s,d) => s + (d.cong_suat_dinh_muc || 0),0);
    const load = rated ? r.tong_cong_suat_w / rated * 100 : null;
    const temps = ds.filter(d => d.online && Number.isFinite(d.latest?.nhiet_do_c)).map(d => d.latest.nhiet_do_c);
    const temp = temps.length ? Math.max(...temps) : null;
    const fault = (load !== null && load > 100) || alerts.some(a =>
      (a.isOpen ?? a.tinh_trang !== 'Đã phục hồi') &&
      (a.snapshot?.rule?.chi_so_can_do || a.chi_so_can_do) === 'cong_suat_w' &&
      (a.ma_phong === r.ma_phong || ds.some(d => d._id === a.ma_thiet_bi)));
    // Offline and confirmed relay-off take precedence over old power alerts.
    const state = !r.online ? 'offline' : ds.length && ds.every(d => d.online && d.trang_thai_relay === false) ? 'off' : fault ? 'fault' : 'normal';
    const times = ds.map(d => d.lastSeen).filter(Boolean).sort();
    return { ...r, load, temp, state, last: times.at(-1) };
  });
  const groups = floors.filter(f => entries.some(r => r.ma_tang === f._id));
  const top = entries.filter(r => r.online).sort((a,b) => b.tong_cong_suat_w-a.tong_cong_suat_w).slice(0,5);
  const fmt = (v: number | null) => v === null ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  const time = (v: string) => v ? new Date(v).toLocaleString('vi-VN') : 'Chưa nhận dữ liệu';
  return <section className="panel floor-plan">
    <div className="panel-head"><div><h2>Mặt bằng tiêu thụ điện</h2><p className="muted">So sánh các phòng trong phạm vi giám sát</p></div>
      <select aria-label="Chỉ số bản đồ" value={metric} onChange={e=>setMetric(e.target.value)}><option value="power">Công suất (kW)</option><option value="load">% tải</option>{entries.some(r=>r.temp!==null) && <option value="temp">Nhiệt độ (°C)</option>}</select>
    </div>
    <div className="plan-tools"><select aria-label="Trạng thái phòng" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tất cả trạng thái</option><option value="normal">Bình thường</option><option value="off">Đã cắt điện</option><option value="offline">Mất kết nối</option><option value="fault">Cảnh báo công suất / Quá tải</option></select><div className="heat-status-legend"><span><i className="gray" /> Tắt nguồn / Offline</span><span><i className="green" /> Trong định mức</span><span><i className="red" /> Vượt định mức / Cảnh báo công suất</span><small>Màu thể hiện trạng thái công suất, kể cả khi xem nhiệt độ.</small></div></div>
    <div className="plan-layout"><div>{groups.map(f=><section className="floor-block" key={f._id}><h3>{buildings.find(b=>b._id===f.buildingId)?.ten_toa_nha} · Tầng {f.so_tang}</h3><div className="room-grid">{entries.filter(r=>r.ma_tang===f._id&&(!status||r.state===status)).map(r=>{
      return <article id={'room-'+r.ma_phong} key={r.ma_phong} className={`room-tile ${r.state} ${focus===r.ma_phong?'focused':''}`} title={`Công suất: ${fmt(r.tong_cong_suat_w/1000)} kW\nTải: ${fmt(r.load)}%\nCập nhật: ${time(r.last)}`}><b>{r.state==='fault'?'⚠ ':r.state==='off'?<svg className="inline-power-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 2v10 M6 5a9 9 0 1 0 12 0" /></svg>:''}{r.ten_phong}</b><strong>{!r.online?'—':fmt(metric==='temp'?r.temp:metric==='load'?r.load:r.tong_cong_suat_w/1000)} <small>{metric==='temp'?'°C':metric==='load'?'%':'kW'}</small></strong><span>{r.state==='offline'?'Mất kết nối':r.state==='off'?'Đã cắt điện':r.state==='fault'?`⚠ Cảnh báo · ${fmt(r.load)}% tải`:`${fmt(r.load)}% tải`}</span>{!r.online&&<small>{time(r.last)}</small>}</article>;
    })}</div><div className="corridor">HÀNH LANG</div></section>)}{!groups.length&&<p>Chưa có phòng trong phạm vi này.</p>}</div><section className="room-ranking"><h3>Top 5 công suất hiện tại</h3>{top.map((r,i)=><button key={r.ma_phong} onClick={()=>{setStatus('');setFocus(r.ma_phong);setTimeout(()=>document.getElementById('room-'+r.ma_phong)?.scrollIntoView({block:'nearest',behavior:'smooth'}),0);}}><span>{i+1}. {r.ten_phong}</span><b>{fmt(r.tong_cong_suat_w/1000)} kW</b></button>)}{!top.length&&<p>Chưa có phòng online.</p>}</section></div>
  </section>;
}
