import {Injectable,OnApplicationBootstrap,OnModuleDestroy,Logger} from '@nestjs/common';import {randomUUID} from 'node:crypto';
import {Database} from './database';import {Catalog} from './catalog';import {Mqtt} from './mqtt';import {Events} from './events';import {Security} from './security';import {Action,isOnline,User} from './domain';import {AckDto} from './dto';
@Injectable() export class Control implements OnApplicationBootstrap,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private busy=false;private log=new Logger('Control');
 constructor(private db:Database,private catalog:Catalog,private mqtt:Mqtt,private events:Events,private security:Security){mqtt.ackHandler=(dto,topic)=>this.ack(dto,topic);}
 async onApplicationBootstrap(){
  // Persisted pending commands survive process restarts and expire using their original deadline.
  this.timer=setInterval(()=>this.expire().catch(e=>this.log.error(e.message)),250);
 }
 onModuleDestroy(){clearInterval(this.timer);}
 async send(id:string,action:Action,u:User|null,schedule?:{id:string,runId:string}){
  const d=await this.catalog.get('devices',id,u||undefined),now=new Date(),commandId=randomUUID();
  const cmd:any={_id:commandId,ma_lenh:commandId,ma_lich_su:commandId,ma_thiet_bi:id,buildingId:d.buildingId,ma_nguoi_dung:u?._id||null,hanh_dong:action,nguon:schedule?'Hẹn giờ':'Thủ công',ma_lich_trinh:schedule?.id||null,runId:schedule?.runId||null,trang_thai:'Đang chờ',thoi_gian_thuc_hien:now,deadline:new Date(+now+5000)};
  await this.db.collection('commands').insertOne(cmd);
  if(!d.cho_phep_dieu_khien)return this.fail(cmd,'Thiết bị không hỗ trợ điều khiển');
  if(!isOnline(d))return this.fail(cmd,'Thiết bị offline');
  if(!this.mqtt.connected)return this.fail(cmd,'MQTT chưa kết nối');
  const locked=await this.db.collection('devices').findOneAndUpdate({_id:id,$or:[{pendingCommand:null},{pendingCommand:{$exists:false}}]},{$set:{pendingCommand:commandId,latestCommandId:commandId}},{returnDocument:'after'});
  if(!locked)return this.fail(cmd,'Thiết bị đang xử lý một lệnh khác');
  // Do not block HTTP until ACK. State changes arrive via authenticated WebSocket.
  this.mqtt.publish(d.chu_de_mqtt+'/command',{ma_lenh:commandId,ma_thiet_bi:id,hanh_dong:action,het_han:cmd.deadline.toISOString()}).then(async()=>{
   await this.db.collection('commands').updateOne({_id:commandId,trang_thai:'Đang chờ'},{$set:{trang_thai:'Đã gửi',sentAt:new Date()}});
  }).catch(e=>this.fail(cmd,e.message).catch(err=>this.log.error(err.message)));
  return cmd;
 }
 private async fail(cmd:any,reason:string){
  const result=await this.db.collection('commands').findOneAndUpdate({_id:cmd._id,trang_thai:{$in:['Đang chờ','Đã gửi']}},{$set:{trang_thai:'Thất bại',loi:reason,completedAt:new Date()}},{returnDocument:'after'});
  await this.db.collection('devices').updateOne({_id:cmd.ma_thiet_bi,pendingCommand:cmd._id},{$set:{pendingCommand:null}});
  if(result)this.events.send(cmd.buildingId,'command',result,true);return result||cmd;
 }
 async ack(dto:AckDto,topic:string){
  const d=await this.catalog.get('devices',dto.ma_thiet_bi);if(topic!==d.chu_de_mqtt+'/ack'){await this.db.audit('INVALID_ACK',{reason:'Topic không khớp'});return;}
  const cmd=await this.db.collection('commands').findOne({_id:dto.ma_lenh,ma_thiet_bi:d._id});if(!cmd){await this.db.audit('INVALID_ACK',{reason:'Không có lệnh tương ứng',command:dto.ma_lenh});return;}
  const time=new Date(dto.thoi_gian),now=new Date();if(+time>+now+5000||+time<+cmd.thoi_gian_thuc_hien-1000){await this.db.audit('INVALID_ACK',{reason:'Thời điểm ACK không hợp lệ'});return;}
  if(+now>+cmd.deadline){await this.fail(cmd,'Hết 5 giây chờ ACK');await this.db.collection('commands').updateOne({_id:cmd._id},{$set:{lateAck:dto}});}
  else {
   const result=await this.db.collection('commands').findOneAndUpdate({_id:cmd._id,trang_thai:{$in:['Đang chờ','Đã gửi']}},{$set:{trang_thai:!dto.loi&&dto.trang_thai_relay===(cmd.hanh_dong==='Bật')?'Thành công':'Thất bại',loi:dto.loi|| (dto.trang_thai_relay===(cmd.hanh_dong==='Bật')?'':'Relay không khớp'),ack:dto,completedAt:now}},{returnDocument:'after'});
   if(result)this.events.send(d.buildingId,'command',result,true);
  }
  // Old ACK cannot overwrite the state of a more recently requested command or measurement.
  await this.db.collection('devices').updateOne({_id:d._id,latestCommandId:cmd._id,$or:[{lastRelayAt:{$lte:time}},{lastRelayAt:{$exists:false}}]},{$set:{trang_thai_relay:dto.trang_thai_relay,lastRelayAt:time,lastSeen:now}});
  await this.db.collection('devices').updateOne({_id:d._id,pendingCommand:cmd._id},{$set:{pendingCommand:null}});
 }
 async logs(u:User){return this.db.collection('commands').find(this.security.buildingFilter(u)).sort({thoi_gian_thuc_hien:-1}).limit(500).toArray();}
 async expire(){if(this.busy)return;this.busy=true;try{const rows=await this.db.collection('commands').find({trang_thai:{$in:['Đang chờ','Đã gửi']},deadline:{$lte:new Date()}}).limit(200).toArray();for(const c of rows)await this.fail(c,'Hết 5 giây chờ ACK');}finally{this.busy=false;}}
}
