// Opt-in load test. Creates its own building/devices; does not overwrite existing devices.
import mqtt from 'mqtt';import{randomUUID}from'node:crypto';
const count=Number(process.env.LOAD_DEVICES||50),seconds=Number(process.env.LOAD_SECONDS||600);
if(!Number.isInteger(count)||count<1||count>200||seconds<10||seconds>3600)throw new Error('LOAD_DEVICES 1..200; LOAD_SECONDS 10..3600');
const base=process.env.API_URL||`http://localhost:${process.env.PORT||3000}/api/v1`;let token='';
async function api(path,method='GET',body){const r=await fetch(base+'/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));return j;}
token=(await api('auth/login','POST',{tai_khoan:process.env.ADMIN_USERNAME||'admin',mat_khau:process.env.ADMIN_PASSWORD})).access_token;
const run=randomUUID().slice(0,8),building=await api('buildings','POST',{ten_toa_nha:'Benchmark '+run});const floor=await api('floors','POST',{ma_toa_nha:building._id,so_tang:1});const room=await api('rooms','POST',{ma_tang:floor._id,ten_phong:'Load test',loai_phong:'LAB'});
const devices=[];for(let i=0;i<count;i++){const suffix=randomUUID().replaceAll('-','').slice(0,12).match(/../g).join(':');devices.push(await api('devices','POST',{ma_phong:room._id,ten_thiet_bi:`LOAD ${i+1}`,dia_chi_mac:suffix,chu_de_mqtt:`campus/load_${run}/device_${i}`,cho_phep_dieu_khien:false,chu_ky_gui:5,cong_suat_dinh_muc:2000}));}
const client=mqtt.connect(process.env.MQTT_URL||'mqtt://localhost:1883',{username:process.env.MQTT_USERNAME,password:process.env.MQTT_PASSWORD,clientId:'load-'+run});await new Promise(r=>client.once('connect',r));
const start=new Date();let sent=0;for(let elapsed=0;elapsed<seconds;elapsed+=5){const tick=Date.now();await Promise.all(devices.map(d=>client.publishAsync(d.chu_de_mqtt+'/telemetry',JSON.stringify({ma_thiet_bi:d._id,thoi_gian_do:new Date().toISOString(),cong_suat_w:500,dien_ap_v:220,dong_dien_a:2.27,nhiet_do_c:30,trang_thai_relay:true}),{qos:1}).then(()=>sent++)));await new Promise(r=>setTimeout(r,Math.max(0,5000-(Date.now()-tick))));if(elapsed%60===0)console.log({elapsed,sent});}
await client.endAsync();await new Promise(r=>setTimeout(r,3000));const end=new Date();let stored=0;
for(const d of devices){let cursor=null;do{const data=await api(`telemetry/device/${d._id}/history?from=${start.toISOString()}&to=${end.toISOString()}${cursor?'&cursor='+cursor:''}`);stored+=data.data.length;cursor=data.nextCursor;}while(cursor);}
console.log(JSON.stringify({buildingId:building._id,devices:count,seconds,sent,stored,lossPercent:(sent-stored)/sent*100,note:'Không tự xóa dữ liệu benchmark; số đo chỉ phản ánh lần chạy này'},null,2));
