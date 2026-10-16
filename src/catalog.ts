import {defined} from './domain';
import {Injectable,NotFoundException,BadRequestException,ConflictException,ForbiddenException} from '@nestjs/common';import {randomUUID} from 'node:crypto';import {hash} from 'bcryptjs';
import {Database} from './database';import {Security} from './security';import {User,isOnline,publicUser} from './domain';import {Events} from './events';
export const keys:Record<string,string>={buildings:'ma_toa_nha',floors:'ma_tang',rooms:'ma_phong',devices:'ma_thiet_bi',users:'ma_nguoi_dung'};
@Injectable() export class Catalog {
 constructor(private db:Database,private security:Security,private events:Events){}
 async get(kind:string,id:string,u?:User){const item=await this.db.collection(kind).findOne({_id:id});if(!item)throw new NotFoundException('Không tìm thấy '+kind);if(u&&kind!=='users')this.security.checkBuilding(u,kind==='buildings'?id:item.buildingId);return item;}
 async list(kind:string,u:User,filter:Record<string,string>={}){
  const q:any=kind==='users'?{}:kind==='buildings'?(u.vai_tro==='Admin'?{}:{_id:{$in:u.buildingIds}}):this.security.buildingFilter(u);
  for(const k of ['ma_toa_nha','ma_tang','ma_phong'])if(filter[k])q[k]=filter[k];
  const rows=await this.db.collection(kind).find(q).sort({createdAt:1}).limit(1000).toArray();
  return rows.map(r=>kind==='users'?publicUser(r):this.present(kind,r));
 }
 present(kind:string,r:any){return {...r,[keys[kind]]:r._id,...(kind==='devices'?{online:isOnline(r)}:{})};}
 async create(kind:string,dto:any,actor:User){
  dto=defined(dto);
  const data={...(kind==='devices'?{cong_suat_dinh_muc:2000,chu_ky_gui:5}:kind==='users'?{active:true}:{}),...dto,_id:randomUUID(),createdAt:new Date(),updatedAt:new Date()};await this.validate(kind,data);
  if(kind==='users'){data.mat_khau=await hash(data.mat_khau,12);data.tokenVersion=0;}
  await this.db.collection(kind).insertOne(data);if(kind==='devices')this.events.emit('device-config',data);await this.db.audit('CREATE',{kind,id:data._id,actor:actor._id});
  return kind==='users'?publicUser(data):this.present(kind,data);
 }
 async update(kind:string,id:string,dto:any,actor:User){
  dto=defined(dto);
  const old=await this.get(kind,id);const data={...old,...dto,updatedAt:new Date()};
  // Moving hierarchy after telemetry exists would invalidate historical scope/snapshots.
  const parent=({floors:'ma_toa_nha',rooms:'ma_tang',devices:'ma_phong'} as any)[kind];
  if(parent&&dto[parent]&&dto[parent]!==old[parent])throw new BadRequestException('Không di chuyển đối tượng sang vị trí khác; tạo đối tượng mới để giữ lịch sử');
  if(kind==='devices'&&dto.chu_de_mqtt&&dto.chu_de_mqtt!==old.chu_de_mqtt)throw new BadRequestException('MQTT topic là định danh cố định; tạo thiết bị mới nếu cần đổi');
  if(kind==='users'&&id===actor._id&&(dto.active===false||dto.vai_tro&&dto.vai_tro!=='Admin'))throw new BadRequestException('Không tự khóa hoặc hạ quyền tài khoản Admin đang dùng');
  await this.validate(kind,data);
  if(kind==='users'){
   if(dto.mat_khau)data.mat_khau=await hash(dto.mat_khau,12);data.tokenVersion=(old.tokenVersion||0)+1;
  }
  await this.db.collection(kind).replaceOne({_id:id},data);if(kind==='users')this.events.emit('revoke',id);
  if(kind==='devices'&&dto.chu_ky_gui!==undefined)this.events.emit('device-config',data);
  await this.db.audit('UPDATE',{kind,id,actor:actor._id});return kind==='users'?publicUser(data):this.present(kind,data);
 }
 async remove(kind:string,id:string,actor:User){
  await this.get(kind,id);
  const refs:Record<string,[string,string][]>= {buildings:[['floors','ma_toa_nha']],floors:[['rooms','ma_tang']],rooms:[['devices','ma_phong']],devices:[['telemetry','ma_thiet_bi'],['hourly','ma_thiet_bi'],['rules','ma_thiet_bi'],['commands','ma_thiet_bi'],['schedules','ma_thiet_bi']]};
  if(kind==='users'){if(id===actor._id)throw new BadRequestException('Không tự khóa tài khoản');await this.db.collection('users').updateOne({_id:id},{$set:{active:false},$inc:{tokenVersion:1}});this.events.emit('revoke',id);return {message:'Đã khóa tài khoản, giữ lại nhật ký'};}
  for(const [c,k]of refs[kind]||[])if(await this.db.collection(c).findOne({[k]:id}))throw new ConflictException('Đối tượng có dữ liệu liên quan, không thể xóa');
  await this.db.collection(kind).deleteOne({_id:id});await this.db.audit('DELETE',{kind,id,actor:actor._id});return {message:'Đã xóa'};
 }
 private async validate(kind:string,d:any){
  if(kind==='floors'){await this.get('buildings',d.ma_toa_nha);d.buildingId=d.ma_toa_nha;}
  if(kind==='rooms'){const p=await this.get('floors',d.ma_tang);d.buildingId=p.buildingId;}
  if(kind==='devices'){const p=await this.get('rooms',d.ma_phong);d.buildingId=p.buildingId;d.dia_chi_mac=d.dia_chi_mac.toUpperCase();}
  if(kind==='users')for(const id of d.buildingIds)await this.get('buildings',id);
 }
}
