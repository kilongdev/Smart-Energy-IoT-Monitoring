export type Role='Admin'|'QuanLy'|'NguoiXem';
export type Action='Bật'|'Tắt';
export interface User { _id:string; tai_khoan:string; ho_ten:string; mat_khau:string; vai_tro:Role; active:boolean; buildingIds:string[]; }
export const IDS={building:'11111111-1111-4111-8111-111111111111',floor:'22222222-2222-4222-8222-222222222222',room:'33333333-3333-4333-8333-333333333333',device:'44444444-4444-4444-8444-444444444444'};
export const HOUR=3600000;
export function hourStart(d:Date){return new Date(Math.floor(d.getTime()/HOUR)*HOUR);}
export function localClock(date:Date,zone='Asia/Ho_Chi_Minh'){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}:${p.second}`,day:({Mon:'T2',Tue:'T3',Wed:'T4',Thu:'T5',Fri:'T6',Sat:'T7',Sun:'CN'} as Record<string,string>)[p.weekday]};
}
export function inWindow(date:Date,window?:string,zone?:string){
 if(!window)return true;const [start,end]=window.split('-');const t=localClock(date,zone).time.slice(0,5);
 return start===end || (start<end?t>=start&&t<end:t>=start||t<end);
}
export function compare(value:number,op:string,threshold:number){return ({'>':value>threshold,'<':value<threshold,'>=':value>=threshold,'<=':value<=threshold,'=':value===threshold} as Record<string,boolean>)[op]??false;}
export function isOnline(d:any,now=Date.now()){return !!d.lastSeen && now-new Date(d.lastSeen).getTime()<=d.chu_ky_gui*3000;}
export function energyBetween(samples:any[],start:number,end:number,maxGap:number){
 let kwh=0,coveredMs=0;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],t0=+new Date(a.thoi_gian_do),t1=+new Date(b.thoi_gian_do),dt=t1-t0;
  if(dt<=0||dt>maxGap)continue;
  const l=Math.max(start,t0),r=Math.min(end,t1);if(r<=l)continue;
  const p0=a.cong_suat_w+(b.cong_suat_w-a.cong_suat_w)*(l-t0)/dt;
  const p1=a.cong_suat_w+(b.cong_suat_w-a.cong_suat_w)*(r-t0)/dt;
  kwh+=(p0+p1)/2*(r-l)/3600000000;coveredMs+=r-l;
 }
 return {kwh,coveredMs};
}
export function publicUser(u:any){const {mat_khau,...out}=u;return {...out,ma_nguoi_dung:u._id};}

export function defined(dto:any){return Object.fromEntries(Object.entries(dto).filter(([,v])=>v!==undefined));}
