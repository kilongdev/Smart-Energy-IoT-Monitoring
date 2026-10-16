import {Injectable,OnApplicationBootstrap,OnModuleDestroy,Logger,BadRequestException,HttpException} from '@nestjs/common';
import mqtt,{MqttClient} from 'mqtt';import {plainToInstance} from 'class-transformer';import {validate} from 'class-validator';
import {Telemetry} from './telemetry';import {TelemetryDto,AckDto} from './dto';import {Database} from './database';import {Events} from './events';
@Injectable() export class Mqtt implements OnApplicationBootstrap,OnModuleDestroy {
 client?:MqttClient;private log=new Logger('MQTT');ackHandler?:(dto:AckDto,topic:string)=>Promise<any>;
 constructor(private telemetry:Telemetry,private db:Database,private events:Events){events.on('device-config',d=>this.publishConfig(d).catch(e=>this.log.warn(e.message)));}
 get connected(){return !!this.client?.connected;}
 onApplicationBootstrap(){
  if(process.env.MQTT_DISABLED==='true')return;
  this.client=mqtt.connect(process.env.MQTT_URL||'mqtt://localhost:1883',{clientId:'smart-energy-backend',username:process.env.MQTT_USERNAME,password:process.env.MQTT_PASSWORD,clean:false,reconnectPeriod:2000,connectTimeout:5000,queueQoSZero:false});
  this.client.on('connect',async()=>{this.log.log('MQTT đã kết nối');this.client!.subscribe('campus/#',{qos:1});try{const ds=await this.db.collection('devices').find().toArray();for(const d of ds)await this.publishConfig(d);}catch(e:any){this.log.error(e.message);}});
  this.client.on('error',e=>this.log.warn(e.message));
  // MQTT.js invokes handleMessage before sending the QoS 1 PUBACK. A DB error
  // closes the connection without acknowledging so a persistent session can replay.
  this.client.handleMessage=(packet,done)=>{
   const topic=packet.topic;
   if(!topic.endsWith('/telemetry')&&!topic.endsWith('/ack'))return done();
   (async()=>{
    if(packet.retain)throw new BadRequestException('Không nhận telemetry/ACK retained');
    if(packet.payload.length>4096)throw new BadRequestException('Payload vượt 4096 bytes');
    let json:any;try{json=JSON.parse(packet.payload.toString());}catch{throw new BadRequestException('JSON không hợp lệ');}
    const dto=topic.endsWith('/ack')?plainToInstance(AckDto,json):plainToInstance(TelemetryDto,json);
    const errors=await validate(dto,{whitelist:true,forbidNonWhitelisted:true,forbidUnknownValues:true});if(errors.length)throw new BadRequestException(errors.map(e=>e.property).join(', '));
    if(topic.endsWith('/ack'))await this.ackHandler?.(dto as AckDto,topic);else await this.telemetry.ingest(dto,topic);
   })().then(()=>done()).catch(async e=>{
    if(e instanceof HttpException){await this.db.audit('INVALID_MQTT',{topic,error:e.message}).catch(()=>{});done();}
    else {this.log.error('Lỗi xử lý MQTT: '+e.message);this.client?.stream.destroy();done(e);}
   });
  };
 }
 async publish(topic:string,payload:any,retain=false){if(!this.client?.connected)throw new Error('MQTT chưa kết nối');await this.client.publishAsync(topic,JSON.stringify(payload),{qos:1,retain});}
 async publishConfig(d:any){if(this.connected)await this.publish(d.chu_de_mqtt+'/config',{chu_ky_gui:d.chu_ky_gui},true);}
 async onModuleDestroy(){await this.client?.endAsync(true);}
}
