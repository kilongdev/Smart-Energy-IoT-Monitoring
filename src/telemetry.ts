import {Injectable,BadRequestException,OnApplicationBootstrap,OnModuleDestroy,Logger} from '@nestjs/common';import {randomUUID} from 'node:crypto';
import {Database} from './database';import {Catalog} from './catalog';import {Alerts} from './alerts';import {Analytics} from './analytics';import {Events} from './events';
@Injectable() export class Telemetry implements OnApplicationBootstrap,OnModuleDestroy {
 private queues=new Map<string,Promise<any>>();private timer?:NodeJS.Timeout;private replaying=false;private log=new Logger('Telemetry');
 constructor(private db:Database,private catalog:Catalog,private alerts:Alerts,private analytics:Analytics,private events:Events){}
 onApplicationBootstrap(){this.timer=setInterval(()=>this.replay().catch(e=>this.log.error(e.message)),5000);}
 onModuleDestroy(){clearInterval(this.timer);}
 ingest(dto:any,topic?:string){const id=dto.ma_thiet_bi;const work=(this.queues.get(id)||Promise.resolve()).catch(()=>{}).then(()=>this.handle(dto,topic));this.queues.set(id,work);work.finally(()=>{if(this.queues.get(id)===work)this.queues.delete(id);}).catch(()=>{});return work;}
 private async handle(dto:any,topic?:string){
  const d=await this.catalog.get('devices',dto.ma_thiet_bi);if(topic&&topic!==d.chu_de_mqtt+'/telemetry')throw new BadRequestException('Topic và mã thiết bị không khớp');
  const measured=new Date(dto.thoi_gian_do),now=new Date();if(+measured>+now+5000||+measured<+now-2592000000)throw new BadRequestException('Thời điểm đo ngoài cửa sổ 30 ngày hoặc nằm trong tương lai');
  const record={...dto,_id:randomUUID(),thoi_gian_do:measured,receivedAt:now,buildingId:d.buildingId,ma_phong:d.ma_phong,processed:false};
  let row:any=record,duplicate=false;
  try{await this.db.collection('telemetry').insertOne(record);}catch(e:any){if(e.code!==11000)throw e;duplicate=true;row=await this.db.collection('telemetry').findOne({ma_thiet_bi:d._id,thoi_gian_do:measured});}
  // Duplicate payloads do not keep a replaying/offline device artificially online.
  if(!duplicate)await this.db.collection('devices').updateOne({_id:d._id},{$set:{lastSeen:now}});
  if(!row.processed)await this.process(d,row);
  return {message:duplicate?'Bản ghi trùng đã được bỏ qua':'Ghi nhận dữ liệu đo thành công',duplicate};
 }
 private async process(d:any,row:any){
  await this.analytics.dirty(d._id,row.thoi_gian_do);
  const updated=await this.db.collection('devices').findOneAndUpdate({_id:d._id,$or:[{'latest.thoi_gian_do':{$lt:row.thoi_gian_do}},{latest:{$exists:false}}]},{$set:{latest:{thoi_gian_do:row.thoi_gian_do,cong_suat_w:row.cong_suat_w,dien_ap_v:row.dien_ap_v,dong_dien_a:row.dong_dien_a,nhiet_do_c:row.nhiet_do_c}}},{returnDocument:'after'});
  await this.db.collection('devices').updateOne({_id:d._id,$or:[{lastRelayAt:{$lte:row.thoi_gian_do}},{lastRelayAt:{$exists:false}}]},{$set:{trang_thai_relay:row.trang_thai_relay,lastRelayAt:row.thoi_gian_do}});
  if(Date.now()-row.thoi_gian_do.getTime()<=d.chu_ky_gui*3000){await this.alerts.evaluate(d,row);}
  if(updated)this.events.send(d.buildingId,'telemetry',{ma_thiet_bi:d._id,...updated.latest,receivedAt:row.receivedAt});
  await this.db.collection('telemetry').updateOne({_id:row._id},{$set:{processed:true}});
 }
 private async replay(){if(this.replaying)return;this.replaying=true;try{const rows=await this.db.collection('telemetry').find({processed:false}).sort({receivedAt:1}).limit(100).toArray();for(const row of rows){const { _id,receivedAt,buildingId,ma_phong,processed,...dto}=row;await this.ingest({...dto,thoi_gian_do:row.thoi_gian_do.toISOString()});}}finally{this.replaying=false;}}
}
