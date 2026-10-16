import 'reflect-metadata';import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {MongoMemoryServer} from 'mongodb-memory-server';import {createServer,Server} from 'node:net';import mqtt,{MqttClient} from 'mqtt';import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app';import {Database} from '../src/database';import {Mqtt} from '../src/mqtt';import {Control} from '../src/control';import {Schedules} from '../src/schedules';import {Analytics} from '../src/analytics';import {IDS,localClock,hourStart} from '../src/domain';
let mongo:MongoMemoryServer,app:any,db:Database,broker:any,server:Server,device:MqttClient,base:string,admin:string,manager:string,viewer:string;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>Promise<any>,timeout=8000){const start=Date.now();while(Date.now()-start<timeout){const result=await fn();if(result)return result;await wait(40);}throw new Error('Timeout waiting for condition');}
async function request(path:string,method='GET',data?:any,token=admin){const response=await fetch(base+'/api/v1/'+path,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,body:await response.json()};}
const sample=(power=600,time=new Date())=>({ma_thiet_bi:IDS.device,thoi_gian_do:time.toISOString(),cong_suat_w:power,dien_ap_v:220,dong_dien_a:power/220,nhiet_do_c:30,trang_thai_relay:true});
async function ingest(power=600,time=new Date()){const r=await request('telemetry/ingest','POST',sample(power,time));assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
before(async()=>{
 process.env.NODE_ENV='test';process.env.JWT_SECRET='integration-test-only-secret-0123456789';process.env.ADMIN_PASSWORD='TestAdmin_123456';process.env.DEMO_PASSWORD='TestDemo_123456';process.env.SEED_DEMO='true';process.env.TELEGRAM_BOT_TOKEN='';process.env.TELEGRAM_CHAT_ID='';
 if(process.env.TEST_STORE==='memory'){const {MemoryStore}=require('./memory-store');const store=new MemoryStore();Database.prototype.onModuleInit=async function(){this.collection=store.collection.bind(store);this.client=store.client;this.db=store.db;};}
 else {mongo=await MongoMemoryServer.create({binary:{version:process.env.TEST_MONGO_VERSION||'8.0.5'}});process.env.MONGO_URI=mongo.getUri();}process.env.MONGO_DB='energy_test';
 broker=require('aedes')();broker.authenticate=(client:any,username:any,password:any,done:any)=>done(null,(username==='energy_api'||username==='energy_sim')&&password?.toString()==='test-mqtt-password');
 server=createServer(broker.handle);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address()as any).port;
 process.env.MQTT_URL=`mqtt://127.0.0.1:${port}`;process.env.MQTT_USERNAME='energy_api';process.env.MQTT_PASSWORD='test-mqtt-password';
 app=await createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();db=app.get(Database);await until(async()=>app.get(Mqtt).connected);
 device=mqtt.connect(process.env.MQTT_URL,{username:'energy_sim',password:'test-mqtt-password'});await new Promise<void>(r=>device.once('connect',()=>r()));await device.subscribeAsync('campus/demo/device1/command',{qos:1});
 for(const [name,pwd,role]of [['admin','TestAdmin_123456','admin'],['manager','TestDemo_123456','manager'],['viewer','TestDemo_123456','viewer']]){const r=await request('auth/login','POST',{tai_khoan:name,mat_khau:pwd},'');assert.equal(r.status,200);if(role==='admin')admin=r.body.access_token;else if(role==='manager')manager=r.body.access_token;else viewer=r.body.access_token;}
}, {timeout:180000});
after(async()=>{await device?.endAsync(true);await app?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));if(broker)await new Promise<void>(r=>broker.close(()=>r()));await mongo?.stop();});
test('JWT, RBAC và phạm vi tòa nhà được kiểm tra phía server',async()=>{
 assert.equal((await request('devices','GET',undefined,'')).status,401);
 assert.equal((await request('buildings','POST',{ten_toa_nha:'Không được'},viewer)).status,403);
 assert.equal((await request(`control/devices/${IDS.device}/switch`,'POST',{hanh_dong:'Tắt'},viewer)).status,403);
 const b=await request('buildings','POST',{ten_toa_nha:'Tòa bí mật'});assert.equal(b.status,201);
 assert.equal((await request('buildings/'+b.body._id,'GET',undefined,manager)).status,403);
 assert.equal((await request('buildings','GET',undefined,viewer)).body.length,1);
});
test('CRUD, tham chiếu và PATCH không đặt lại giá trị mặc định',async()=>{
 assert.equal((await request('floors','POST',{ma_toa_nha:randomUUID(),so_tang:2})).status,404);
 assert.equal((await request('floors','POST',{ma_toa_nha:IDS.building,so_tang:1})).status,409);
 assert.equal((await request('buildings/'+IDS.building,'DELETE')).status,409);
 await request('devices/'+IDS.device,'PATCH',{chu_ky_gui:7});await request('devices/'+IDS.device,'PATCH',{ten_thiet_bi:'ESP32 kiểm thử'});
 assert.equal((await db.collection('devices').findOne({_id:IDS.device}))!.chu_ky_gui,7);
 assert.equal((await request('devices/'+IDS.device,'PATCH',{chu_ky_gui:null})).status,400);
 await request('devices/'+IDS.device,'PATCH',{chu_ky_gui:5});
});
test('Telemetry hợp lệ, trùng timestamp và dữ liệu sai',async()=>{
 const t=new Date();const first=await ingest(600,t),second=await ingest(600,t);assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);
 assert.equal(await db.collection('telemetry').countDocuments({ma_thiet_bi:IDS.device,thoi_gian_do:t}),1);
 assert.equal((await request('telemetry/ingest','POST',{...sample(),cong_suat_w:-5})).status,400);
 assert.equal((await request('telemetry/ingest','POST',{...sample(),admin:true})).status,400);
 assert.equal((await request('telemetry/ingest','POST',sample(100,new Date(Date.now()+60000)))).status,400);
 const last=await db.collection('devices').findOne({_id:IDS.device});await ingest(20,new Date(Date.now()-3600000));assert.equal((await db.collection('devices').findOne({_id:IDS.device}))!.latest.cong_suat_w,last!.latest.cong_suat_w);
});
test('MQTT nhận payload thật và từ chối topic giả mạo',async()=>{
 const msg=sample(777);await device.publishAsync('campus/demo/device1/telemetry',JSON.stringify(msg),{qos:1});
 await until(()=>db.collection('telemetry').findOne({ma_thiet_bi:IDS.device,thoi_gian_do:new Date(msg.thoi_gian_do)}));
 const invalid=sample(888,new Date(Date.now()+1));await device.publishAsync('campus/demo/device2/telemetry',JSON.stringify(invalid),{qos:1});await wait(150);
 assert.equal(await db.collection('telemetry').countDocuments({ma_thiet_bi:IDS.device,thoi_gian_do:new Date(invalid.thoi_gian_do)}),0);
});
test('Debounce, cooldown, snapshot và vòng đời cảnh báo',async()=>{
 const r=await request('alerts/rules','POST',{ma_thiet_bi:IDS.device,ten_quy_tac:'Quá tải',chi_so_can_do:'cong_suat_w',toan_tu:'>',gia_tri_nguong:1000,thoi_gian_duy_tri:2,cooldown:60},manager);assert.equal(r.status,201);
 await ingest(1500,new Date(Date.now()-4000));assert.equal(await db.collection('alerts').countDocuments(),0);
 await ingest(1600);const a=await db.collection('alerts').findOne({ma_quy_tac:r.body._id});assert.ok(a);assert.equal(a.trang_thai,'Mới');assert.equal(a.snapshot.sample.cong_suat_w,1600);
 await wait(5);await ingest(1700);assert.equal(await db.collection('alerts').countDocuments({ma_quy_tac:r.body._id}),1);
 assert.equal((await request(`alerts/history/${a._id}/status`,'PATCH',{trang_thai:'Đã xử lý'},manager)).status,409);
 assert.equal((await request(`alerts/history/${a._id}/status`,'PATCH',{trang_thai:'Đã xác nhận'},manager)).status,200);
 assert.equal((await request(`alerts/history/${a._id}/status`,'PATCH',{trang_thai:'Đã xử lý',ghi_chu:'Kiểm tra xong'},manager)).status,200);
 await request('alerts/rules/'+r.body._id,'PATCH',{bat:false},manager);
});
test('Lệnh 202 không tự thành công; ACK đúng mới xác nhận',async()=>{
 await ingest();const r=await request(`control/devices/${IDS.device}/switch`,'POST',{hanh_dong:'Tắt'},manager);assert.equal(r.status,202);assert.equal(r.body.trang_thai,'Đang chờ');
 const before=await db.collection('devices').findOne({_id:IDS.device});assert.equal(before!.trang_thai_relay,true);
 await device.publishAsync('campus/demo/device1/ack',JSON.stringify({ma_thiet_bi:IDS.device,ma_lenh:r.body.ma_lenh,trang_thai_relay:false,thoi_gian:new Date().toISOString()}),{qos:1});
 const result=await until(()=>db.collection('commands').findOne({_id:r.body._id,trang_thai:'Thành công'}));assert.equal(result.ma_nguoi_dung!==null,true);
 await until(async()=>!(await db.collection('devices').findOne({_id:IDS.device}))!.pendingCommand);
 assert.equal((await db.collection('devices').findOne({_id:IDS.device}))!.trang_thai_relay,false);
});
test('ACK sai mã bị bỏ qua, không có ACK thì timeout; ACK muộn không xóa thất bại',async()=>{
 await ingest();const r=await request(`control/devices/${IDS.device}/switch`,'POST',{hanh_dong:'Bật'},manager);
 await device.publishAsync('campus/demo/device1/ack',JSON.stringify({ma_thiet_bi:IDS.device,ma_lenh:randomUUID(),trang_thai_relay:true,thoi_gian:new Date().toISOString()}),{qos:1});
 const timed=await until(()=>db.collection('commands').findOne({_id:r.body._id,trang_thai:'Thất bại'}),6500);assert.match(timed.loi,/5 giây/);
 await device.publishAsync('campus/demo/device1/ack',JSON.stringify({ma_thiet_bi:IDS.device,ma_lenh:r.body.ma_lenh,trang_thai_relay:true,thoi_gian:new Date().toISOString()}),{qos:1});
 await until(()=>db.collection('commands').findOne({_id:r.body._id,lateAck:{$exists:true}}));assert.equal((await db.collection('commands').findOne({_id:r.body._id}))!.trang_thai,'Thất bại');
});
test('Thiết bị offline ghi thất bại, không publish lệnh thành công giả',async()=>{
 await db.collection('devices').updateOne({_id:IDS.device},{$set:{lastSeen:new Date(Date.now()-16000)}});
 const r=await request(`control/devices/${IDS.device}/switch`,'POST',{hanh_dong:'Tắt'},manager);assert.equal(r.body.trang_thai,'Thất bại');assert.match(r.body.loi,/offline/);
});
test('Lịch đến giờ chỉ tạo một lần chạy, lịch tắt không chạy và xung đột bị chặn',async()=>{
 await ingest();const now=new Date();const clock=localClock(now);const r=await request('control/schedules','POST',{ma_thiet_bi:IDS.device,hanh_dong:'Tắt',gio_bat_dau:clock.time,ngay_lap_lai:clock.day},manager);assert.equal(r.status,201);
 assert.equal((await request('control/schedules','POST',{ma_thiet_bi:IDS.device,hanh_dong:'Bật',gio_bat_dau:clock.time,ngay_lap_lai:clock.day},manager)).status,409);
 const service=app.get(Schedules);await service.tick(now);await service.tick(now);
 assert.equal(await db.collection('schedule_runs').countDocuments({ma_lich_trinh:r.body._id}),1);
 assert.equal(await db.collection('commands').countDocuments({ma_lich_trinh:r.body._id}),1);
 await request('control/schedules/'+r.body._id,'PATCH',{bat:false},manager);await service.tick(new Date(+now+86400000));assert.equal(await db.collection('schedule_runs').countDocuments({ma_lich_trinh:r.body._id}),1);
});
test('Tổng hợp điện năng được tính lại khi nhận mẫu đến trễ; không cộng trùng',async()=>{
 const start=+hourStart(new Date(Date.now()-7200000))+1000;
 await ingest(0,new Date(start));await ingest(1000,new Date(start+10000));await ingest(1000,new Date(start+5000));await ingest(1000,new Date(start+5000));
 await app.get(Analytics).flush();const row=await until(()=>db.collection('hourly').findOne({ma_thiet_bi:IDS.device,hour:hourStart(new Date(start))}));
 assert.ok(Math.abs(row.kwh-7500/3600000)<1e-9,JSON.stringify(row));assert.equal(row.coveredMs,10000);
});
test('Swagger và dashboard được phục vụ cùng API',async()=>{
 assert.equal((await fetch(base)).status,200);const docs=await fetch(base+'/docs-json');assert.equal(docs.status,200);const json:any=await docs.json();assert.ok(json.paths['/api/v1/control/devices/{id}/switch']);
});
