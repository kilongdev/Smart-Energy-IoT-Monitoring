import {Controller,Get,Post,Patch,Delete,Body,Param,Query,Req,ParseUUIDPipe,HttpCode,BadRequestException} from '@nestjs/common';
import {ApiTags,ApiBearerAuth,ApiBody,ApiQuery} from '@nestjs/swagger';
import {Database} from './database';import {Catalog} from './catalog';import {Security,Roles,Public} from './security';import {Telemetry} from './telemetry';import {Analytics} from './analytics';import {Alerts} from './alerts';import {Control} from './control';import {Schedules} from './schedules';import {Mqtt} from './mqtt';
import {TelemetryDto,RuleDto,UpdateRuleDto,SwitchDto,ScheduleDto,UpdateScheduleDto,AlertStateDto,HistoryDto,RangeDto} from './dto';
const manager=()=>Roles('Admin','QuanLy');
export const body=(example:any)=>ApiBody({schema:{type:'object',properties:Object.fromEntries(Object.entries(example).map(([k,v])=>[k,{type:Array.isArray(v)?'array':typeof v,example:v,...(Array.isArray(v)?{items:{type:'string'}}:{})}]))}});
@ApiTags('Giám sát') @ApiBearerAuth() @Controller()
export class MonitoringController {
 constructor(private analytics:Analytics,private telemetry:Telemetry,private catalog:Catalog,private db:Database,private mqtt:Mqtt){}
 @Public() @Get('health') health(){return {status:'ok',mqtt:this.mqtt.connected};}
 @Get('dashboard') dashboard(@Req() r:any){return this.analytics.dashboard(r.user);}
 @Get('rooms/:id/heatmap') async heatmap(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){await this.catalog.get('rooms',id,r.user);return (await this.analytics.dashboard(r.user)).heatmap.find(x=>x.ma_phong===id);}
 @Roles('Admin') @Post('telemetry/ingest')
 @body({ma_thiet_bi:'44444444-4444-4444-8444-444444444444',thoi_gian_do:'2026-10-15T08:00:00Z',cong_suat_w:620,dien_ap_v:220,dong_dien_a:2.8,nhiet_do_c:32,trang_thai_relay:true})
 async ingest(@Body() dto:TelemetryDto){return this.telemetry.ingest(dto);}
 @Get('telemetry/device/:id/history') @ApiQuery({name:'from',required:true}) @ApiQuery({name:'to',required:true}) @ApiQuery({name:'cursor',required:false})
 history(@Param('id',ParseUUIDPipe) id:string,@Query() q:HistoryDto,@Req() r:any){return this.analytics.history(id,q.from,q.to,r.user,q.cursor);}
 @Get('analytics/energy') @ApiQuery({name:'from',required:true}) @ApiQuery({name:'to',required:true}) @ApiQuery({name:'period',enum:['day','week','month'],required:false}) @ApiQuery({name:'buildingId',required:false}) @ApiQuery({name:'ma_phong',required:false})
 energy(@Query('from') from:string,@Query('to') to:string,@Query('period') period:string,@Query('buildingId') b:string,@Query('ma_phong') room:string,@Req() r:any){return this.analytics.energy(from,to,period||'day',r.user,b,room);}
 @Roles('Admin') @Get('audit') audit(){return this.db.collection('audit').find().sort({at:-1}).limit(200).toArray();}
}
@ApiTags('Cảnh báo') @ApiBearerAuth() @manager() @Controller('alerts')
export class AlertController {
 constructor(private alerts:Alerts){}
 @Get('rules') rules(@Req() r:any){return this.alerts.rules(r.user);}
 @Post('rules') @body({ma_thiet_bi:'44444444-4444-4444-8444-444444444444',ten_quy_tac:'Quá tải',chi_so_can_do:'cong_suat_w',toan_tu:'>',gia_tri_nguong:1000,thoi_gian_duy_tri:10,cooldown:60,muc_do:'HIGH',bat:true})
 create(@Body() d:RuleDto,@Req() r:any){return this.alerts.saveRule(d,r.user);}
 @Patch('rules/:id') @body({bat:false}) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateRuleDto,@Req() r:any){return this.alerts.saveRule(d,r.user,id);}
 @Get('history') history(@Req() r:any,@Query() q:any){return this.alerts.history(r.user,q);}
 @Patch('history/:id/status') @body({trang_thai:'Đã xác nhận',ghi_chu:'Đã tiếp nhận sự cố'}) state(@Param('id',ParseUUIDPipe) id:string,@Body() d:AlertStateDto,@Req() r:any){return this.alerts.transition(id,d,r.user);}
}
@ApiTags('Điều khiển và hẹn giờ') @ApiBearerAuth() @manager() @Controller('control')
export class ControlController {
 constructor(private control:Control,private schedules:Schedules,private db:Database,private security:Security){}
 @Post('devices/:id/switch') @HttpCode(202) @body({hanh_dong:'Tắt'}) switch(@Param('id',ParseUUIDPipe) id:string,@Body() d:SwitchDto,@Req() r:any){return this.control.send(id,d.hanh_dong,r.user);}
 @Get('logs') logs(@Req() r:any){return this.control.logs(r.user);}
 @Get('schedules') list(@Req() r:any){return this.schedules.list(r.user);}
 @Post('schedules') @body({ma_thiet_bi:'44444444-4444-4444-8444-444444444444',hanh_dong:'Tắt',gio_bat_dau:'17:00:00',ngay_lap_lai:'T2,T3,T4,T5,T6',bat:true}) create(@Body() d:ScheduleDto,@Req() r:any){return this.schedules.save(d,r.user);}
 @Patch('schedules/:id') @body({bat:false}) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateScheduleDto,@Req() r:any){return this.schedules.save(d,r.user,id);}
 @Delete('schedules/:id') remove(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){return this.schedules.remove(id,r.user);}
 @Get('runs') runs(@Req() r:any){return this.db.collection('schedule_runs').find(this.security.buildingFilter(r.user)).sort({createdAt:-1}).limit(200).toArray();}
}
