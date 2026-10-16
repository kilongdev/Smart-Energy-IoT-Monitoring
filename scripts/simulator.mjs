import mqtt from 'mqtt';
const client=mqtt.connect(process.env.MQTT_URL||'mqtt://localhost:1883',{username:'energy_sim',password:process.env.SIM_MQTT_PASSWORD,clientId:'energy-simulator',clean:false,reconnectPeriod:2000});
const state=Array.from({length:3},(_,i)=>({id:`44444444-4444-4444-8444-44444444444${4+i}`,topic:`campus/demo/device${i+1}`,relay:true,period:5,last:0,acks:new Map()}));
client.on('connect',()=>{for(const d of state){client.subscribe(d.topic+'/command',{qos:1});client.subscribe(d.topic+'/config',{qos:1});}console.log('Simulator đã kết nối: 3 thiết bị');});
client.on('error',e=>console.error('MQTT:',e.message));
client.on('message',(topic,bytes)=>{try{
 const d=state.find(d=>topic.startsWith(d.topic+'/'));if(!d)return;const payload=JSON.parse(bytes.toString());
 if(topic.endsWith('/config')){if(Number.isInteger(payload.chu_ky_gui)&&payload.chu_ky_gui>=1&&payload.chu_ky_gui<=60)d.period=payload.chu_ky_gui;return;}
 if(payload.ma_thiet_bi!==d.id)return;
 if(d.acks.has(payload.ma_lenh)){client.publish(d.topic+'/ack',JSON.stringify(d.acks.get(payload.ma_lenh)),{qos:1});return;}
 if(Date.parse(payload.het_han)<Date.now()||!['Bật','Tắt'].includes(payload.hanh_dong))return;
 const mode=process.env.SIM_ACK_MODE||'normal';d.relay=payload.hanh_dong==='Bật';
 if(mode==='drop')return;
 const ack={ma_lenh:mode==='wrong-id'?'00000000-0000-4000-8000-000000000000':payload.ma_lenh,ma_thiet_bi:d.id,trang_thai_relay:mode==='mismatch'?!d.relay:d.relay,thoi_gian:new Date().toISOString()};
 d.acks.set(payload.ma_lenh,ack);if(d.acks.size>1000)d.acks.delete(d.acks.keys().next().value);
 setTimeout(()=>client.publish(d.topic+'/ack',JSON.stringify(ack),{qos:1}),mode==='late'?6500:150);
}catch(e){console.error(e.message);}});
const timer=setInterval(()=>{if(!client.connected)return;for(let i=0;i<state.length;i++){
 const d=state[i];if(Date.now()-d.last<d.period*1000)continue;d.last=Date.now();
 const power=d.relay?Math.round((process.env.SIM_MODE==='overload'?2400:450+i*220)+Math.random()*120):0;
 const payload={ma_thiet_bi:d.id,thoi_gian_do:new Date().toISOString(),cong_suat_w:power,dien_ap_v:Math.round((219+Math.random()*3)*10)/10,dong_dien_a:Math.round(power/220*100)/100,nhiet_do_c:Math.round((d.relay?32+i*2:27)*10)/10,trang_thai_relay:d.relay};
 const message=JSON.stringify(payload);client.publish(d.topic+'/telemetry',message,{qos:1});if(process.env.SIM_MODE==='duplicate')client.publish(d.topic+'/telemetry',message,{qos:1});
}},200);
process.on('SIGTERM',()=>{clearInterval(timer);client.end(true);});
process.on('SIGINT',()=>{clearInterval(timer);client.end(true);});
