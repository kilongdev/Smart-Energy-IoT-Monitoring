import {Injectable,BadRequestException,OnModuleDestroy,OnApplicationBootstrap,Logger} from '@nestjs/common';
import {Database} from './database';import {Security} from './security';import {Catalog} from './catalog';import {HOUR,hourStart,energyBetween,User,isOnline} from './domain';
@Injectable() export class Analytics implements OnApplicationBootstrap,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private busy=false;private log=new Logger('Analytics');
 constructor(private db:Database,private security:Security,private catalog:Catalog){}
 onApplicationBootstrap(){this.timer=setInterval(()=>this.flush().catch(e=>this.log.error(e.message)),2000);}
 onModuleDestroy(){clearInterval(this.timer);}
 async dirty(deviceId:string,time:Date){
  const hour=+hourStart(time);
  // Adjacent buckets may change when a sample arrives out of order near a boundary.
  for(const h of [hour-HOUR,hour,hour+HOUR])await this.db.collection('dirty_hours').updateOne({_id:`${deviceId}:${h}`},{$set:{deviceId,hour:new Date(h)},$inc:{revision:1}},{upsert:true});
 }
 async flush(){if(this.busy)return;this.busy=true;try{
  const tasks=await this.db.collection('dirty_hours').find().limit(150).toArray();
  for(const task of tasks){
   const d=await this.db.collection('devices').findOne({_id:task.deviceId});if(!d){await this.db.collection('dirty_hours').deleteOne({_id:task._id});continue;}
   const start=+task.hour,end=start+HOUR,gap=d.chu_ky_gui*3000;
   const rows=await this.db.collection('telemetry').find({ma_thiet_bi:d._id,thoi_gian_do:{$gte:new Date(start-gap),$lte:new Date(end+gap)}}).sort({thoi_gian_do:1}).toArray();
   const stats=energyBetween(rows,start,end,gap);
   await this.db.collection('hourly').updateOne({ma_thiet_bi:d._id,hour:task.hour},{$set:{...stats,buildingId:d.buildingId,ma_phong:d.ma_phong,updatedAt:new Date()}},{upsert:true});
   await this.db.collection('dirty_hours').deleteOne({_id:task._id,revision:task.revision});
  }
 }finally{this.busy=false;}}
 range(from:string,to:string,maxDays=31){const a=new Date(from),b=new Date(to);if(!Number.isFinite(+a)||!Number.isFinite(+b)||a>=b||+b-+a>maxDays*86400000)throw new BadRequestException(`Khoảng thời gian phải tăng dần và tối đa ${maxDays} ngày`);return {a,b};}
 async history(id:string,from:string,to:string,u:User,cursor?:string){await this.catalog.get('devices',id,u);const {a,b}=this.range(from,to);const q:any={ma_thiet_bi:id,thoi_gian_do:{$gte:a,$lt:b}};
  if(cursor){const c=new Date(cursor);if(!Number.isFinite(+c)||c<a||c>=b)throw new BadRequestException('Cursor không hợp lệ');q.thoi_gian_do={$gt:c,$lt:b};}
  const rows=await this.db.collection('telemetry').find(q,{projection:{_id:0,processed:0}}).sort({thoi_gian_do:1}).limit(1001).toArray();const more=rows.length>1000;const data=rows.slice(0,1000);
  return {data,nextCursor:more?data.at(-1)?.thoi_gian_do.toISOString():null};
 }
 async energy(from:string,to:string,period:string,u:User,buildingId?:string,roomId?:string){
  const {a,b}=this.range(from,to,366);if(!['day','week','month'].includes(period))throw new BadRequestException('period phải là day/week/month');
  // Hour aggregates are exact for hour-aligned bounds; reject partial hours rather than overcount.
  if(+a%HOUR||+b%HOUR)throw new BadRequestException('Mốc from/to phải tròn giờ; khoảng thời gian dạng [from,to)');
  const q:any={...this.security.buildingFilter(u),hour:{$gte:a,$lt:b}};
  if(buildingId){this.security.checkBuilding(u,buildingId);q.buildingId=buildingId;}
  if(roomId){await this.catalog.get('rooms',roomId,u);q.ma_phong=roomId;}
  const results=await this.db.collection('hourly').aggregate([
   {$match:q},{$group:{_id:{$dateTrunc:{date:'$hour',unit:period,timezone:'Asia/Ho_Chi_Minh',...(period==='week'?{startOfWeek:'monday'}:{})}},dien_nang_kwh:{$sum:'$kwh'},thoi_gian_co_du_lieu_ms:{$sum:'$coveredMs'}}},{$sort:{_id:1}}
  ]).toArray();return {data:results,unit:'kWh',timezone:'Asia/Ho_Chi_Minh',method:'Tích phân hình thang; bỏ khoảng trống > 3 chu kỳ; tổng hợp theo giờ',pendingBuckets:await this.db.collection('dirty_hours').countDocuments()};
 }
 async dashboard(u:User){
  const devices=await this.catalog.list('devices',u);const rooms=await this.catalog.list('rooms',u);const now=Date.now();
  const heatmap=rooms.map(r=>{const ds=devices.filter(d=>d.ma_phong===r._id),on=ds.filter(d=>isOnline(d,now));const power=on.reduce((s,d)=>s+(d.latest?.cong_suat_w||0),0);const rated=ds.reduce((s,d)=>s+d.cong_suat_dinh_muc,0);return {ma_phong:r._id,ten_phong:r.ten_phong,ma_tang:r.ma_tang,buildingId:r.buildingId,tong_cong_suat_w:power,online:on.length,total:ds.length,muc_do_canh_bao:on.length===0?'NO_DATA':power>rated*.8?'HIGH':power>rated*.5?'MEDIUM':'LOW'};});
  return {devices,heatmap,totalPowerW:heatmap.reduce((s,r)=>s+r.tong_cong_suat_w,0),online:devices.filter(d=>d.online).length,total:devices.length,serverTime:new Date()};
 }
}
