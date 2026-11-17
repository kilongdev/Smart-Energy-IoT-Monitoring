import React, { useEffect, useRef, useState, memo } from 'react';
type Row = Record<string, any>;
const number = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const date = (v: any) => v ? new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa có dữ liệu';
const pending = (c?: Row) => c && ['Đang chờ','Đã gửi'].includes(c.trang_thai);
function AnimatedPower({ value }: { value?: number }) {
  const [display, setDisplay] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    if (!Number.isFinite(value)) { current.current=undefined; setDisplay(undefined); return; }
    if (!Number.isFinite(current.current) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { current.current=value; setDisplay(value); return; }
    const from=current.current!, to=value!, start=performance.now(); let frame=0;
    const tick=(now:number)=>{ const p=Math.min(1,(now-start)/280);current.current=from+(to-from)*(1-Math.pow(1-p,3));setDisplay(current.current);if(p<1)frame=requestAnimationFrame(tick); };
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[value]);
  return <>{display === undefined ? '—' : number(display)}</>;
}
const DeviceCard = memo(function DeviceCard({ device:d, room, command, saving, run, Chart, Icon }: any) {
  const [points,setPoints]=useState<[number,number][]>([]);
  const [sending,setSending]=useState(false);
  const guard=useRef(false);
  const measured=+new Date(d.latest?.thoi_gian_do || 0), power=d.latest?.cong_suat_w;
  useEffect(()=>{
    if (!measured || !Number.isFinite(power)) return;
    setPoints(previous=>previous.length && measured<=previous[previous.length-1][0] ? previous : [...previous,[measured,power] as [number,number]].slice(-40));
  },[measured,power]);
  const awaiting = !!d.pendingCommand || pending(command);
  const disabled=!d.online || !d.cho_phep_dieu_khien || saving || awaiting || sending;
  const relay=typeof d.trang_thai_relay==='boolean' ? d.trang_thai_relay ? 'Đang bật' : 'Đang tắt' : 'Chưa xác định';
  async function send(action:string) {
    if(disabled || guard.current)return;
    guard.current=true;setSending(true);
    try { await run(`control/devices/${d._id}/switch`,'POST',{hanh_dong:action},`Đã tạo lệnh ${action}; đang chờ ACK`); }
    finally {guard.current=false;setSending(false);}
  }
  return <article className={'panel smart-device '+(!d.online?'is-offline':'')}>
    <div className="smart-device-head"><span className="control-icon"><Icon name="control" /></span><div><h2>{d.ten_thiet_bi}</h2><p>{room?.ten_phong || 'Chưa có phòng'}</p></div><span className={'control-badge '+(d.online?'online':'offline')}><i />{d.online?'Online':'Offline'}</span></div>
    <div className="smart-power"><span>{d.online?'Công suất tức thời':'Công suất ghi nhận lần cuối'}</span><strong><AnimatedPower value={Number.isFinite(power)?power:undefined} /><small> W</small></strong><small>Cập nhật lần cuối: {date(d.latest?.receivedAt || d.lastSeen)}</small></div>
    <div className="control-spark" aria-label="Xu hướng công suất từ các mẫu nhận khi mở trang">{points.length>1?<Chart height={56} option={{animationDurationUpdate:250,grid:{left:2,right:2,top:5,bottom:4},xAxis:{type:'time',show:false},yAxis:{type:'value',show:false,scale:true},tooltip:{trigger:'axis'},series:[{type:'line',showSymbol:false,data:points,lineStyle:{color:d.online?'#327d60':'#94a099',width:2},areaStyle:{color:'#dcece1',opacity:.5}}]}} />:<span>Đang thu thập dữ liệu xu hướng</span>}</div>
    <div className="relay-status"><span>{d.online?'Trạng thái relay':'Relay ghi nhận lần cuối'}</span><b>{relay}</b></div>
    <div className="relay-segment" aria-label={'Điều khiển '+d.ten_thiet_bi}>{['Bật','Tắt'].map(action=><button key={action} disabled={disabled} aria-pressed={d.online && d.trang_thai_relay === (action==='Bật')} className={d.online && d.trang_thai_relay === (action==='Bật')?'confirmed':''} onClick={()=>send(action)}><span className="inline-ui-icon" aria-hidden="true"><Icon name="control" /></span> {action}</button>)}</div>
    {awaiting && <div className="command-feedback pending" role="status"><span className="command-spinner" aria-hidden="true" /><span>Đang chờ thiết bị xác nhận</span></div>}
  </article>;
});
export function ControlPage({ devices, rooms, commands, popup, connected, loading, error, retry, saving, run, Chart, Icon, Metric }: any) {
  const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[sort,setSort]=useState('online');
  const commandFor=(d:Row)=>{
    const candidates=commands.filter((c:Row)=>c.ma_thiet_bi===d._id);
    if(popup?.ma_thiet_bi===d._id){
      const i=candidates.findIndex((c:Row)=>c._id===popup._id);
      const rank=(c:Row)=>['Thành công','Thất bại'].includes(c.trang_thai)?2:c.trang_thai==='Chưa xác định'?1:0;
      if(i>=0){if(rank(popup)>=rank(candidates[i]))candidates[i]=popup;}else candidates.push(popup);
    }
    return candidates.sort((a:Row,b:Row)=>+new Date(b.thoi_gian_thuc_hien)-+new Date(a.thoi_gian_thuc_hien))[0];
  };
  const waiting=devices.filter((d:Row)=>d.pendingCommand || pending(commandFor(d))).length;
  const online=devices.filter((d:Row)=>d.online).length;
  const latest=devices.map((d:Row)=>d.latest?.receivedAt || d.lastSeen).filter(Boolean).sort().at(-1);
  const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase();
  const shown=devices.filter((d:Row)=>(!status||(status==='online'?d.online:!d.online))&&normalized(`${d.ten_thiet_bi} ${rooms.find((r:Row)=>r._id===d.ma_phong)?.ten_phong || ''}`).includes(normalized(search.trim()))).sort((a:Row,b:Row)=>sort==='power'?(b.latest?.cong_suat_w??-1)-(a.latest?.cong_suat_w??-1):sort==='online'?Number(b.online)-Number(a.online):String(rooms.find((r:Row)=>r._id===a.ma_phong)?.ten_phong || a.ten_thiet_bi).localeCompare(String(rooms.find((r:Row)=>r._id===b.ma_phong)?.ten_phong || b.ten_thiet_bi),'vi',{numeric:true}));
  return <div className="control-page"><div className="control-info"><Icon name="control" /><span>Lệnh điều khiển chỉ được xác nhận thành công sau khi thiết bị phản hồi ACK hợp lệ.</span></div>
    <div className={'metrics'+(loading?' loading-metrics':'')} aria-busy={loading}>{[['TỔNG THIẾT BỊ',devices.length,'Gateway trong phạm vi'],['ĐANG KẾT NỐI',online,'Có dữ liệu kết nối từ backend'],['MẤT KẾT NỐI',devices.length-online,'Offline hoặc chưa từng kết nối'],['LỆNH ĐANG CHỜ ACK',waiting,'Theo trạng thái lệnh từ backend']].map(([label,value,detail])=><Metric key={label} label={label} value={loading||error?'—':value} detail={detail} />)}</div>
    <div className="control-livebar"><span><i className={connected?'dot live':'dot'} /> Socket.IO: {connected?'Connected':'Disconnected'}</span><span>{loading?'—':online} thiết bị Online</span><span>Telemetry gần nhất: {date(latest)}</span><span>{loading?'—':waiting} lệnh chờ ACK</span></div>
    <div className="control-toolbar"><input aria-label="Tìm thiết bị hoặc phòng" placeholder="Tìm gateway hoặc phòng…" value={search} onChange={e=>setSearch(e.target.value)} /><select aria-label="Trạng thái kết nối" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tất cả kết nối</option><option value="online">Online</option><option value="offline">Offline</option></select><select aria-label="Sắp xếp thiết bị" value={sort} onChange={e=>setSort(e.target.value)}><option value="online">Online trước</option><option value="name">Tên phòng</option><option value="power">Công suất giảm dần · gồm số đo cuối</option></select><span>{shown.length} / {devices.length} thiết bị</span></div>
    {error?<div className="panel" role="alert"><h2>Không thể tải danh sách thiết bị</h2><p>{error}</p><button onClick={retry}>Thử lại</button></div>:loading?<div className="control-device-grid" aria-busy="true">{[0,1,2].map(i=><div key={i} className="panel control-skeleton">Đang tải thiết bị…</div>)}</div>:!shown.length?<div className="panel control-empty"><Icon name="control" /><h2>{devices.length?'Không có thiết bị phù hợp bộ lọc':'Không có thiết bị trong phạm vi giám sát'}</h2><p>Chọn phạm vi khác hoặc kiểm tra bộ lọc tìm kiếm.</p></div>:<div className="control-device-grid">{shown.map((d:Row)=><DeviceCard key={d._id} device={d} room={rooms.find((r:Row)=>r._id===d.ma_phong)} command={commandFor(d)} saving={saving} run={run} Chart={Chart} Icon={Icon} />)}</div>}
  </div>;
}
