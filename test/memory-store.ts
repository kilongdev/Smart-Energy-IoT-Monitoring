/** Test double only. Does NOT validate MongoDB transactions, indexes, TTL or performance. */
import {Query} from 'mingo';import {randomUUID} from 'node:crypto';
const clone=<T>(v:T):T=>structuredClone(v);
const get=(o:any,k:string)=>k.split('.').reduce((v,p)=>v?.[p],o);
const set=(o:any,k:string,v:any)=>{const p=k.split('.');let x=o;for(const name of p.slice(0,-1))x=x[name]??=( {});x[p.at(-1)!]=clone(v);};
const matches=(row:any,q:any)=>new Query(q).test(row);
const duplicate=()=>Object.assign(new Error('Duplicate test key'),{code:11000});
export class MemoryStore {
 private tables=new Map<string,any[]>();
 db:any={};client:any={close:async()=>{}};
 collection(name:string):any {
  if(!this.tables.has(name))this.tables.set(name,[]);const data=this.tables.get(name)!;
  const check=(row:any,except?:any)=>{if(data.some(x=>x!==except&&x._id===row._id))throw duplicate();
   const keys:Record<string,string[][]>={users:[['tai_khoan']],floors:[['ma_toa_nha','so_tang']],rooms:[['ma_tang','ten_phong']],devices:[['dia_chi_mac'],['chu_de_mqtt']],telemetry:[['ma_thiet_bi','thoi_gian_do']],hourly:[['ma_thiet_bi','hour']]};
   for(const fields of keys[name]||[])if(data.some(x=>x!==except&&fields.every(k=>JSON.stringify(x[k])===JSON.stringify(row[k]))))throw duplicate();
  };
  const cursor=(rows:any[])=>{let values=rows;return {sort(s:any){values.sort((a,b)=>{for(const [k,d]of Object.entries(s)){const av=get(a,k),bv=get(b,k);if(av>bv)return Number(d);if(av<bv)return -Number(d);}return 0});return this;},limit(n:number){values=values.slice(0,n);return this;},async toArray(){return clone(values)}}};
  const find=(q:any={})=>cursor(data.filter(x=>matches(x,q)));
  const apply=(row:any,update:any,insert=false)=>{for(const [op,payload]of Object.entries<any>(update)){for(const [key,value]of Object.entries<any>(payload)){if(op==='$set'||(op==='$setOnInsert'&&insert))set(row,key,value);if(op==='$inc')set(row,key,(get(row,key)||0)+value);if(op==='$push')set(row,key,[...(get(row,key)||[]),value]);if(op==='$unset')delete row[key];}}};
  return {
   createIndex:async()=>{},find,
   async findOne(q:any={},opts:any={}){const cur=find(q);if(opts.sort)cur.sort(opts.sort);return (await cur.limit(1).toArray())[0]||null;},
   async countDocuments(q:any={}){return data.filter(x=>matches(x,q)).length;},
   async insertOne(row:any){const r=clone(row);r._id??=randomUUID();check(r);data.push(r);return {insertedId:r._id};},
   async updateOne(q:any,update:any,opts:any={}){let row=data.find(x=>matches(x,q));if(!row&&!opts.upsert)return {matchedCount:0};const insert=!row;if(!row){row={_id:typeof q._id==='string'?q._id:randomUUID()};for(const[k,v]of Object.entries(q))if(typeof v!=='object'||v instanceof Date)set(row,k,v);}
    const next=clone(row);apply(next,update,insert);check(next,insert?undefined:row);if(insert)data.push(next);else Object.assign(row,next);return {matchedCount:1,modifiedCount:1};},
   async findOneAndUpdate(q:any,u:any,opts:any={}){const row=data.find(x=>matches(x,q));if(!row)return null;const before=clone(row);apply(row,u);return clone(opts.returnDocument==='after'?row:before);},
   async replaceOne(q:any,replacement:any,opts:any={}){const index=data.findIndex(x=>matches(x,q));check(replacement,index<0?undefined:data[index]);if(index<0&&opts.upsert)data.push(clone(replacement));else if(index>=0)data[index]=clone(replacement);return {matchedCount:index<0?0:1};},
   async deleteOne(q:any){const i=data.findIndex(x=>matches(x,q));if(i>=0)data.splice(i,1);return {deletedCount:i>=0?1:0};},
   // Preview requests only. Real aggregation is covered by the real-Mongo suite.
   aggregate(){return {async toArray(){return []}};}
  };
 }
 async onModuleInit(){} async onModuleDestroy(){}
 async audit(kind:string,detail:any){await this.collection('audit').insertOne({kind,detail,at:new Date()});}
}
