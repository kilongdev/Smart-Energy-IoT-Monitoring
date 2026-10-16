import {defined} from './domain';
import {Injectable,ConflictException,OnApplicationBootstrap,OnModuleDestroy,Logger} from '@nestjs/common';import {randomUUID} from 'node:crypto';
import {Database} from './database';import {Events} from './events';import {Security} from './security';import {Catalog} from './catalog';import {compare,inWindow,User} from './domain';
@Injectable() export class Alerts implements OnApplicationBootstrap,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private sending=false;private log=new Logger('Alerts');
 constructor(private db:Database,private events:Events,private catalog:Catalog,private security:Security){}
 onApplicationBootstrap(){this.timer=setInterval(()=>this.notifications().catch(e=>this.log.error(e.message)),1000);}
 onModuleDestroy(){clearInterval(this.timer);}
 async rules(u:User){return this.db.collection('rules').find(this.security.buildingFilter(u)).sort({createdAt:-1}).toArray();}
 async saveRule(dto:any,u:User,id?:string){
  dto=defined(dto);
  const old=id?await this.db.collection('rules').findOne({_id:id}):null;if(id&&!old)throw new ConflictException('Quy tắc không tồn tại');if(old)this.security.checkBuilding(u,old.buildingId);
  const data={thoi_gian_duy_tri:10,cooldown:60,muc_do:'HIGH',bat:true,...old,...dto};const d=await this.catalog.get('devices',data.ma_thiet_bi,u);
  const item={...data,_id:id||randomUUID(),buildingId:d.buildingId,ma_phong:d.ma_phong,start:null,lastSample:null,updatedAt:new Date(),createdAt:old?.createdAt||new Date()};
  await this.db.collection('rules').replaceOne({_id:item._id},item,{upsert:true});return {...item,ma_quy_tac:item._id};
 }
 async evaluate(d:any,s:any){
  const rules=await this.db.collection('rules').find({ma_thiet_bi:d._id,bat:true}).toArray();const measured=+s.thoi_gian_do;
  for(const rule of rules){
   if(rule.lastSample&&measured<=+rule.lastSample)continue;
   const violation=inWindow(s.thoi_gian_do,rule.khung_gio_ap_dung)&&compare(s[rule.chi_so_can_do],rule.toan_tu,rule.gia_tri_nguong);
   const start=violation?(rule.start&&rule.lastSample&&measured-(+rule.lastSample)<=d.chu_ky_gui*3000?rule.start:s.thoi_gian_do):null;
   await this.db.collection('rules').updateOne({_id:rule._id,updatedAt:rule.updatedAt},{$set:{start,lastSample:s.thoi_gian_do}});
   if(!start||measured-(+start)<rule.thoi_gian_duy_tri*1000)continue;
   // Reserve a cooldown slot before queuing notification. It also limits failures/retries.
   const now=new Date();const claimed=await this.db.collection('rules').findOneAndUpdate({_id:rule._id,bat:true,updatedAt:rule.updatedAt,$or:[{lastAttempt:{$exists:false}},{lastAttempt:null},{lastAttempt:{$lte:new Date(+now-rule.cooldown*1000)}}]},{$set:{lastAttempt:now}},{returnDocument:'after'});
   if(!claimed)continue;
   let alert=await this.db.collection('alerts').findOne({ma_quy_tac:rule._id,trang_thai:{$in:['Mới','Đã xác nhận']}}, {sort:{thoi_gian_phat_hien:-1}});
   const message=`${d.ten_thiet_bi}: ${rule.chi_so_can_do} = ${s[rule.chi_so_can_do]} (${rule.toan_tu} ${rule.gia_tri_nguong}). ${now.toISOString()}`;
   if(!alert){alert={_id:randomUUID(),ma_quy_tac:rule._id,ma_thiet_bi:d._id,buildingId:d.buildingId,ma_phong:d.ma_phong,thoi_gian_phat_hien:now,trang_thai:'Mới',muc_do:rule.muc_do,noi_dung_loi:message,snapshot:{rule:{ten_quy_tac:rule.ten_quy_tac,chi_so_can_do:rule.chi_so_can_do,toan_tu:rule.toan_tu,gia_tri_nguong:rule.gia_tri_nguong},sample:s},occurrences:0};await this.db.collection('alerts').insertOne(alert);}
   await this.db.collection('alerts').updateOne({_id:alert._id},{$set:{lastSeen:now,trang_thai_gui:'Đang chờ',notificationText:message,nextRetry:now,attempts:0,cooldown:rule.cooldown},$inc:{occurrences:1}});
   this.events.send(d.buildingId,'alert',{id:alert._id,message},true);
  }
 }
 async history(u:User,filter:any){
  const q:any={...this.security.buildingFilter(u)};for(const k of ['ma_phong','muc_do','trang_thai'])if(filter[k])q[k]=String(filter[k]);
  if(filter.from||filter.to){q.thoi_gian_phat_hien={};for(const [key,op]of [['from','$gte'],['to','$lt']])if(filter[key]){const date=new Date(filter[key]);if(!Number.isFinite(+date))throw new ConflictException('Thời gian không hợp lệ');q.thoi_gian_phat_hien[op]=date;}}
  return this.db.collection('alerts').find(q).sort({thoi_gian_phat_hien:-1}).limit(500).toArray();
 }
 async transition(id:string,dto:any,u:User){const a=await this.db.collection('alerts').findOne({_id:id});if(!a)throw new ConflictException('Không tìm thấy cảnh báo');this.security.checkBuilding(u,a.buildingId);
  const expected=dto.trang_thai==='Đã xác nhận'?'Mới':'Đã xác nhận';
  const changed=await this.db.collection('alerts').findOneAndUpdate({_id:id,trang_thai:expected},{$set:{trang_thai:dto.trang_thai},$push:{history:{userId:u._id,at:new Date(),trang_thai:dto.trang_thai,ghi_chu:dto.ghi_chu||''}}} as any,{returnDocument:'after'});
  if(!changed)throw new ConflictException('Trạng thái đã thay đổi hoặc chưa xác nhận cảnh báo');this.events.send(a.buildingId,'alert',{id},true);return changed;
 }
 async notifications(){if(this.sending)return;this.sending=true;try{
  const pending=await this.db.collection('alerts').find({trang_thai_gui:{$in:['Đang chờ','Thất bại']},nextRetry:{$lte:new Date()},attempts:{$lt:3}}).limit(10).toArray();
  await Promise.all(pending.map(async a=>{
   if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_CHAT_ID){await this.db.collection('alerts').updateOne({_id:a._id},{$set:{trang_thai_gui:'Chưa cấu hình'}});return;}
   let state='Thành công',error='';
   try{const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text:a.notificationText}),signal:AbortSignal.timeout(3000)});const json:any=await r.json();if(!r.ok||!json.ok)throw new Error(`Telegram HTTP ${r.status}`);}catch(e){state='Thất bại';error=e instanceof Error?e.message:'Lỗi gửi';}
   const now=new Date();await this.db.collection('alerts').updateOne({_id:a._id},{$set:{trang_thai_gui:state,nextRetry:new Date(+now+Math.max(a.cooldown,30)*1000)},$inc:{attempts:1},$push:{deliveryLog:{at:now,state,error}}} as any);
  }));
 }finally{this.sending=false;}}
}
