import {Injectable,OnModuleInit,OnModuleDestroy,Logger} from '@nestjs/common';
import {MongoClient,Db} from 'mongodb';
@Injectable()
export class Database implements OnModuleInit,OnModuleDestroy {
 client!:MongoClient; db!:Db;private log=new Logger(Database.name);
 collection(name:string){return this.db.collection<any>(name);}
 async onModuleInit(){
  if(!process.env.MONGO_URI)throw new Error('Thiếu MONGO_URI. Chạy npm run setup trước.');
  this.client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:8000});await this.client.connect();this.db=this.client.db(process.env.MONGO_DB||'smart_energy');
  const indexes:[string,any,any][]=[
   ['users',{tai_khoan:1},{unique:true}],['floors',{ma_toa_nha:1,so_tang:1},{unique:true}],['rooms',{ma_tang:1,ten_phong:1},{unique:true}],
   ['devices',{dia_chi_mac:1},{unique:true}],['devices',{chu_de_mqtt:1},{unique:true}],['devices',{buildingId:1},{}],
   ['telemetry',{ma_thiet_bi:1,thoi_gian_do:1},{unique:true}],['telemetry',{thoi_gian_do:1},{expireAfterSeconds:2592000}],
   ['telemetry',{buildingId:1,thoi_gian_do:1},{}],['telemetry',{processed:1,receivedAt:1},{}],
   ['hourly',{buildingId:1,hour:1},{}],['hourly',{ma_thiet_bi:1,hour:1},{unique:true}],
   ['rules',{ma_thiet_bi:1,bat:1},{}],['alerts',{buildingId:1,thoi_gian_phat_hien:-1},{}],
   ['alerts',{ma_quy_tac:1,trang_thai:1},{}],['commands',{buildingId:1,thoi_gian_thuc_hien:-1},{}],
   ['commands',{trang_thai:1,deadline:1},{}],['schedules',{bat:1},{}],['schedules',{ma_thiet_bi:1,gio_bat_dau:1,days:1},{unique:true,partialFilterExpression:{bat:true}}],['schedule_runs',{createdAt:1},{expireAfterSeconds:7776000}],
   ['audit',{at:1},{expireAfterSeconds:2592000}]
  ];
  for(const [c,key,opts] of indexes)await this.collection(c).createIndex(key,opts);
  this.log.log('MongoDB đã kết nối; chỉ mục và TTL đã sẵn sàng');
 }
 async audit(kind:string,detail:Record<string,any>){await this.collection('audit').insertOne({kind,detail,at:new Date()});}
 async onModuleDestroy(){await this.client?.close();}
}
