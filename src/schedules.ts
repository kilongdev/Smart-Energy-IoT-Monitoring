import {defined} from './domain';
import {Injectable,ConflictException,OnApplicationBootstrap,OnModuleDestroy,Logger} from '@nestjs/common';import {randomUUID} from 'node:crypto';
import {Database} from './database';import {Catalog} from './catalog';import {Security} from './security';import {Control} from './control';import {User,localClock} from './domain';
@Injectable() export class Schedules implements OnApplicationBootstrap,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private busy=false;private log=new Logger('Schedules');
 constructor(private db:Database,private catalog:Catalog,private security:Security,private control:Control){}
 onApplicationBootstrap(){this.timer=setInterval(()=>this.tick().catch(e=>this.log.error(e.message)),1000);}
 onModuleDestroy(){clearInterval(this.timer);}
 async list(u:User){return this.db.collection('schedules').find(this.security.buildingFilter(u)).sort({createdAt:-1}).toArray();}
 async save(dto:any,u:User,id?:string){
  dto=defined(dto);
  const old=id?await this.db.collection('schedules').findOne({_id:id}):null;if(id&&!old)throw new ConflictException('Lịch không tồn tại');if(old)this.security.checkBuilding(u,old.buildingId);
  const data={bat:true,...old,...dto};const d=await this.catalog.get('devices',data.ma_thiet_bi,u);if(!d.cho_phep_dieu_khien)throw new ConflictException('Thiết bị không hỗ trợ điều khiển');
  const days=[...new Set<string>(data.ngay_lap_lai.split(','))];
  const conflict=await this.db.collection('schedules').findOne({_id:{$ne:id||''},ma_thiet_bi:d._id,gio_bat_dau:data.gio_bat_dau,days:{$in:days},bat:true});
  if(data.bat!==false&&conflict)throw new ConflictException('Đã có lịch cùng thiết bị, giờ và ngày');
  const row={...data,_id:id||randomUUID(),buildingId:d.buildingId,days,timezone:'Asia/Ho_Chi_Minh',createdAt:old?.createdAt||new Date(),updatedAt:new Date()};
  await this.db.collection('schedules').replaceOne({_id:row._id},row,{upsert:true});return {...row,ma_lich_trinh:row._id};
 }
 async remove(id:string,u:User){const old=await this.db.collection('schedules').findOne({_id:id});if(!old)throw new ConflictException('Lịch không tồn tại');this.security.checkBuilding(u,old.buildingId);await this.db.collection('schedules').deleteOne({_id:id});return {message:'Đã xóa lịch, giữ nhật ký lần chạy'};}
 async tick(now=new Date()){
  if(this.busy)return;this.busy=true;try{
   const clock=localClock(now);const schedules=await this.db.collection('schedules').find({bat:true,days:clock.day}).toArray();
   const seconds=(t:string)=>t.split(':').reduce((s,v)=>s*60+Number(v),0);
   for(const s of schedules){
    const lag=seconds(clock.time)-seconds(s.gio_bat_dau);if(lag<0)continue;
    const runId=`${s._id}:${clock.date}:${s.gio_bat_dau}`;
    // Newly created/edited schedules do not retroactively generate a run before their edit.
    const edit=localClock(s.updatedAt);if(edit.date===clock.date&&edit.time>s.gio_bat_dau)continue;
    try{await this.db.collection('schedule_runs').insertOne({_id:runId,ma_lich_trinh:s._id,buildingId:s.buildingId,createdAt:now,status:lag<=5?'Đang chạy':'Bị lỡ',lagSeconds:lag});}catch(e:any){if(e.code===11000)continue;throw e;}
    if(lag>5)continue;
    const current=await this.db.collection('schedules').findOne({_id:s._id,bat:true,updatedAt:s.updatedAt});if(!current){await this.db.collection('schedule_runs').updateOne({_id:runId},{$set:{status:'Đã hủy'}});continue;}
    try{const cmd=await this.control.send(s.ma_thiet_bi,s.hanh_dong,null,{id:s._id,runId});await this.db.collection('schedule_runs').updateOne({_id:runId},{$set:{status:'Đã tạo lệnh',ma_lenh:cmd._id}});}catch(e:any){await this.db.collection('schedule_runs').updateOne({_id:runId},{$set:{status:'Thất bại',error:e.message}});}
   }
  }finally{this.busy=false;}
 }
}
