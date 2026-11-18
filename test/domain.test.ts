import {test} from 'node:test';import assert from 'node:assert/strict';import {energyBetween,inWindow,isOnline,localClock,compare} from '../src/domain';
import { Catalog } from '../src/catalog';
import { MemoryStore as MemoryDatabase } from './memory-store';
import { mergeAlertRecords, isAlertOpen } from '../web/alert-records';
import { updateLiveReading, preserveNewerReadings } from '../web/live-readings';
import { createAlertRefresh } from '../web/alert-refresh';
import { Telemetry } from '../src/telemetry';
import { VirtualDevices } from '../src/virtual-devices';

test('Virtual fleet protects Wokwi IDs and stops a duplicate publisher without blocking other rooms', async t => {
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const old=process.env.SIM_VIRTUAL_EXCLUDE; process.env.SIM_VIRTUAL_EXCLUDE='extra';
 try {
  const db=new MemoryDatabase();
  for(const id of ['44444444-4444-4444-8444-444444444444','e5a539e0-b1c2-498c-8153-5349795974fd','extra','virtual','other'])
   await db.collection('devices').insertOne({_id:id,chu_de_mqtt:'campus/devices/'+id,chu_ky_gui:2});
  const sim=new VirtualDevices(db as any) as any,sent:any[]=[];
  sim.client={connected:true,publishAsync:async(topic:string,payload:string)=>sent.push({topic,payload:JSON.parse(payload)})};
  await sim.loadDevices();assert.equal(sim.devices.size,2);
  await sim.tick();assert.equal(sent.length,0,'listen before publishing');
  t.mock.timers.tick(8000);await sim.tick();assert.equal(sent.length,2);
  const state=sim.devices.get('campus/devices/virtual');
  await sim.loadDevices();assert.equal(sim.devices.get(state.topic),state,'preserve in-flight state');
  const own=sent.find(x=>x.payload.ma_thiet_bi==='virtual');
  sim.handle(own.topic,Buffer.from(JSON.stringify(own.payload)));assert.equal(state.blocked,false);
  sim.handle(own.topic,Buffer.from(JSON.stringify({...own.payload,thoi_gian_do:new Date(Date.now()+1).toISOString()})));
  assert.equal(state.blocked,true);
  t.mock.timers.tick(2000);await sim.tick();assert.equal(sent.length,3);
  assert.equal(sent[2].payload.ma_thiet_bi,'other');
 } finally {if(old===undefined)delete process.env.SIM_VIRTUAL_EXCLUDE;else process.env.SIM_VIRTUAL_EXCLUDE=old;}
});
import { readAuthToken, saveAuthToken, clearAuthToken } from '../web/auth-storage';

test('Remember login stores only the token; switching mode and logout clear both stores', () => {
 const storage=()=>{const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)} as unknown as Storage;};
 const session=storage(),local=storage();
 saveAuthToken('session-token',false,session,local);
 assert.equal(readAuthToken(session,local),'session-token');
 assert.equal(local.getItem('energy-token'),null);
 saveAuthToken('remembered-token',true,session,local);
 assert.equal(session.getItem('energy-token'),null);
 assert.equal(readAuthToken(storage(),local),'remembered-token');
 saveAuthToken('new-account',false,session,local);
 assert.equal(local.getItem('energy-token'),null);
 clearAuthToken(session,local);
 assert.equal(readAuthToken(session,local),null);
});
import { createAlertLiveOverlay, upsertLiveAlert } from '../web/alert-live';

test('Socket recovery and delivery details survive an older HTTP response', () => {
 const live=createAlertLiveOverlay();
 const active={_id:'a',isOpen:true,measurementState:'ACTIVE',thoi_gian_phat_hien:'2026-11-18T10:00:00Z'};
 live.beginRead();
 const recovering={...active,measurementState:'RECOVERING',snapshot:{sample:{cong_suat_w:3000}}};
 live.accept(recovering);
 assert.equal(live.reconcile([active])[0].measurementState,'RECOVERING');
 const recovered={...recovering,isOpen:false,measurementState:'RECOVERED',trang_thai_gui:'sent'};
 live.accept(recovered);
 assert.deepEqual(live.reconcile([active],true),[]);
 assert.deepEqual(live.reconcile([active]),[recovered]);
 assert.deepEqual(upsertLiveAlert([active],recovered,true),[]);
 live.beginRead();
 assert.deepEqual(live.reconcile([recovered]),[recovered]);
});

test('Telemetry preserves evaluation order, does not block other devices, and awaits persistence', async () => {
 const db = new MemoryDatabase();
 for (const id of ['a','b']) await db.collection('devices').insertOne({_id:id,chu_de_mqtt:'campus/devices/'+id});
 let release!:()=>void, started!:()=>void;
 const gate = new Promise<void>(r=>release=r), entered=new Promise<void>(r=>started=r);
 const calls:string[]=[];
 const telemetry=new Telemetry(db as any,{get:async(_:string,id:string)=>({_id:id,chu_de_mqtt:'campus/devices/'+id})} as any,
  {evaluate:async(d:any,s:any)=>{calls.push(d._id+':'+s.cong_suat_w);if(d._id==='a'&&s.cong_suat_w===5000){started();await gate;}}} as any,
  {dirty:async()=>{}} as any,{send:()=>{}} as any);
 const now=Date.now();
 const sample=(id:string,power:number,offset:number)=>({ma_thiet_bi:id,thoi_gian_do:new Date(now+offset).toISOString(),cong_suat_w:power,trang_thai_relay:true});
 const first=telemetry.ingest(sample('a',5000,0));await entered;
 const second=telemetry.ingest(sample('a',3000,1));
 await telemetry.ingest(sample('b',100,0));
 assert.deepEqual(calls,['a:5000','b:100']);
 assert.equal(await db.collection('telemetry').countDocuments({ma_thiet_bi:'a',processed:true}),0);
 release();await Promise.all([first,second]);
 assert.deepEqual(calls,['a:5000','b:100','a:3000']);
 assert.equal(await db.collection('telemetry').countDocuments({processed:true}),3);
 await telemetry.ingest({...sample('a',3000,1),trang_thai_relay:false});
 assert.equal((await db.collection('devices').findOne({_id:'a'})).trang_thai_relay,true);
 assert.equal(calls.length,3);
});

test('Alert event during HTTP read is not lost and stale response cannot overwrite recovery', async () => {
 const reads: Array<(value:string)=>void> = [];
 const commits: string[] = [];
 const refresh = createAlertRefresh(() => new Promise<string>(resolve=>reads.push(resolve)),
   value=>commits.push(value), error=>{throw error;});
 const first = refresh.request();
 refresh.request(); // RECOVERED event while ACTIVE request is pending
 reads[0]('ACTIVE');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(commits,[]);
 assert.equal(reads.length,2);
 reads[1]('RECOVERED');
 await first;
 assert.deepEqual(commits,['RECOVERED']);
 const reconnect = refresh.request();
 reads[2]('NEW ACTIVE'); await reconnect;
 assert.deepEqual(commits,['RECOVERED','NEW ACTIVE']);
 const oldSession = refresh.request(); refresh.dispose();
 reads[3]('OLD USER DATA'); await oldSession;
 assert.equal(commits.length,2);
});

test('Background loads cannot starve alert refresh and one failed request does not disable later events', async () => {
 let finish!: (value:string)=>void;
 let failure = false;
 const commits:string[] = [], errors:unknown[]=[];
 const refresh = createAlertRefresh(() => failure ? Promise.reject(new Error('offline'))
   : new Promise<string>(resolve=>{finish=resolve;}), value=>commits.push(value),error=>errors.push(error));
 const first = refresh.request();
 for(let i=0;i<20;i++) refresh.request(false);
 finish('ACTIVE'); await first;
 assert.deepEqual(commits,['ACTIVE']);
 failure=true; await refresh.request(); assert.equal(errors.length,1);
 failure=false; const next=refresh.request(); finish('RECOVERED'); await next;
 assert.deepEqual(commits,['ACTIVE','RECOVERED']);
});

test('Live telemetry updates room power and stale HTTP cannot roll it back', () => {
 const now = new Date().toISOString();
 const before = {devices:[{_id:'d',online:false,chu_ky_gui:2}],heatmap:[{gatewayId:'d',tong_cong_suat_w:0,online:false}]};
 const sample = {ma_thiet_bi:'d',receivedAt:now,thoi_gian_do:now,cong_suat_w:123,dien_ap_v:175};
 const live = updateLiveReading(before,sample);
 assert.equal(live.devices[0].latest.dien_ap_v,175);
 assert.equal(live.heatmap[0].tong_cong_suat_w,123);
 assert.equal(live.heatmap[0].online,true);
 assert.equal(preserveNewerReadings(before,live).heatmap[0].tong_cong_suat_w,123);
 assert.equal(updateLiveReading(live,{...sample,thoi_gian_do:new Date(Date.now()-10000).toISOString(),cong_suat_w:999}),live);
});

test('Active notification projections cannot erase Telegram or recovery details', () => {
 const history = [{_id:'a', trang_thai_gui:'Thành công', tinh_trang:'Đang phục hồi', snapshot:{rule:{gia_tri_nguong:4000},sample:{cong_suat_w:3000}}}];
 const active = [{_id:'a', tinh_trang:'Đang diễn ra',snapshot:{rule:{ten_quy_tac:'Quá tải'}}},{_id:'b',tinh_trang:'Đang diễn ra'}];
 const merged=mergeAlertRecords(history,active);
 assert.equal(merged.length,2);
 assert.deepEqual(merged[0],history[0]);
 assert.equal(merged[1]._id,'b');
});

test('A recovery between active and history requests must not remain counted as open', () => {
 const active = [{_id:'a', tinh_trang:'Đang diễn ra'}, {_id:'b', tinh_trang:'Đang phục hồi'}];
 const history = [{_id:'a', isOpen:false, tinh_trang:'Đã kết thúc'}];
 const merged = mergeAlertRecords(history, active);
 assert.deepEqual(merged.filter(isAlertOpen).map(a=>a._id), ['b']);
 assert.equal(isAlertOpen({tinh_trang:'Đã gộp'}), false);
});

test('Catalog hierarchy filters intersect access scope', async () => {
 const db = new MemoryDatabase();
 await db.collection('rooms').insertOne({_id:'room-a',ma_tang:'floor-a',buildingId:'a'});
 await db.collection('devices').insertOne({_id:'a',ma_phong:'room-a',buildingId:'a',chu_de_mqtt:'a'});
 await db.collection('devices').insertOne({_id:'b',ma_phong:'room-b',buildingId:'b',chu_de_mqtt:'b'});
 const catalog = new Catalog(db as any, {buildingFilter:()=>({buildingId:'a'})} as any, {} as any);
 assert.equal((await catalog.list('devices',{} as any,{ma_toa_nha:'a',ma_tang:'floor-a'})).length,1);
 assert.equal((await catalog.list('devices',{} as any,{ma_toa_nha:'b'})).length,0);
 assert.equal((await catalog.list('devices',{} as any,{ma_tang:'missing'})).length,0);
});

test('Catalog edits preserve concurrent telemetry and trim names', async () => {
 const db = new MemoryDatabase();
 await db.collection('rooms').insertOne({_id:'room',buildingId:'building'});
 await db.collection('devices').insertOne({_id:'device',ma_phong:'room',buildingId:'building',ten_thiet_bi:'Old',latest:{cong_suat_w:1}});
 const catalog = new Catalog(db as any, {} as any, {emit(){}} as any);
 const originalGet = catalog.get.bind(catalog);
 catalog.get = async (...args: Parameters<typeof catalog.get>) => {
   const result = await originalGet(...args);
   if(args[0] === 'rooms') await db.collection('devices').updateOne({_id:'device'},{$set:{latest:{cong_suat_w:999}}});
   return result;
 };
 await catalog.update('devices','device',{ten_thiet_bi:'  New  '},{_id:'admin'} as any);
 const device = await db.collection('devices').findOne({_id:'device'});
 assert.equal(device.ten_thiet_bi,'New');
 assert.equal(device.latest.cong_suat_w,999);
 await assert.rejects(catalog.update('devices','device',{ten_thiet_bi:'  '},{_id:'admin'} as any), /khoảng trắng/);
});

test('Catalog refuses deletion of devices with alert history', async () => {
 const db = new MemoryDatabase();
 await db.collection('devices').insertOne({_id:'device'});
 await db.collection('alerts').insertOne({_id:'alert',ma_thiet_bi:'device'});
 const catalog = new Catalog(db as any, {} as any, {emit(){}} as any);
 await assert.rejects(catalog.remove('devices','device',{_id:'admin'} as any), /lịch sử cảnh báo/);
 assert.ok(await db.collection('devices').findOne({_id:'device'}));
});
test('Khung giờ qua nửa đêm dùng giờ Việt Nam và loại điểm kết thúc',()=>{
 assert.equal(inWindow(new Date('2026-10-15T16:00:00Z'),'22:00-06:00'),true);
 assert.equal(inWindow(new Date('2026-10-14T23:00:00Z'),'22:00-06:00'),false);
 assert.equal(inWindow(new Date('2026-10-15T04:00:00Z'),'22:00-06:00'),false);
 assert.equal(localClock(new Date('2026-10-15T10:00:00Z')).time,'17:00:00');
});
test('Điện năng tính theo timestamp, cắt ở biên giờ, không nối khoảng mất dữ liệu',()=>{
 const rows=[{thoi_gian_do:new Date(0),cong_suat_w:1000},{thoi_gian_do:new Date(10000),cong_suat_w:1000},{thoi_gian_do:new Date(60000),cong_suat_w:1000}];
 assert.equal(energyBetween(rows,5000,60000,15000).coveredMs,5000);
 assert.ok(Math.abs(energyBetween(rows,0,10000,15000).kwh-10000/3600000)<1e-10);
});
test('Online có giới hạn ba chu kỳ, số đo 0 vẫn hợp lệ',()=>{
 assert.equal(isOnline({lastSeen:new Date(0),chu_ky_gui:5},25000),true);assert.equal(isOnline({lastSeen:new Date(0),chu_ky_gui:5},25001),false);
 assert.equal(compare(0,'<=',0),true);assert.equal(compare(10,'>',20),false);
});
