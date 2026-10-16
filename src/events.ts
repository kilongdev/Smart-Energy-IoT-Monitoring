import {Injectable,OnModuleDestroy} from '@nestjs/common';import {EventEmitter} from 'node:events';
import {WebSocketGateway,WebSocketServer,OnGatewayConnection} from '@nestjs/websockets';import {Server,Socket} from 'socket.io';
import {Security} from './security';
@Injectable() export class Events extends EventEmitter {
 send(buildingId:string,type:string,data:any,management=false){this.emit('push',{buildingId,type,data,management});}
}
@WebSocketGateway({transports:['websocket'],maxHttpBufferSize:8192})
export class RealtimeGateway implements OnGatewayConnection,OnModuleDestroy {
 @WebSocketServer() server!:Server;private timers=new Map<string,NodeJS.Timeout>();
 constructor(private security:Security,private events:Events){
  events.on('push',e=>this.server?.to(e.management?[`manage:${e.buildingId}`,'manage:*']:[`building:${e.buildingId}`,'building:*']).emit(e.type,e.data));
  events.on('revoke',(id:string)=>{for(const s of this.server?.sockets.sockets.values()||[])if(s.data.user?._id===id)s.disconnect(true);});
 }
 async handleConnection(socket:Socket){
  try {
   const token=socket.handshake.auth?.token;const user=await this.security.authenticate(token);socket.data.user=user;
   // Admin joins all existing building rooms; new buildings trigger a reconnect event.
   let ids=user.buildingIds;
   if(user.vai_tro==='Admin')ids=['*'];
   for(const id of ids){socket.join(`building:${id}`);if(user.vai_tro!=='NguoiXem')socket.join(`manage:${id}`);}
   const timer=setInterval(()=>this.security.authenticate(token).catch(()=>socket.disconnect(true)),30000);this.timers.set(socket.id,timer);
   socket.on('disconnect',()=>{clearInterval(timer);this.timers.delete(socket.id);});
  }catch{socket.disconnect(true);}
 }
 onModuleDestroy(){for(const t of this.timers.values())clearInterval(t);}
}
