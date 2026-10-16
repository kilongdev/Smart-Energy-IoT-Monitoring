import {Controller,Get,Post,Patch,Delete,Body,Param,Req,Query,ParseUUIDPipe} from '@nestjs/common';
import {ApiTags,ApiBearerAuth} from '@nestjs/swagger';
import {Catalog} from './catalog';import {publicUser} from './domain';import {Roles} from './security';import {body} from './api';
import {BuildingDto,UpdateBuildingDto,FloorDto,UpdateFloorDto,RoomDto,UpdateRoomDto,DeviceDto,UpdateDeviceDto,UserDto,UpdateUserDto} from './dto';

@ApiTags('buildings') @ApiBearerAuth()  @Controller('buildings')
export class BuildingController {
 constructor(private catalog:Catalog){}
 @Get() list(@Req() r:any,@Query() q:any){return this.catalog.list('buildings',r.user,q);}
 @Get(':id') async get(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){const found=await this.catalog.get('buildings',id,r.user);return this.catalog.present('buildings',found);}
 @Roles('Admin') @Post() @body({"ten_toa_nha": "Tòa A", "dia_chi": "SGU"}) create(@Body() d:BuildingDto,@Req() r:any){return this.catalog.create('buildings',d,r.user);}
 @Roles('Admin') @Patch(':id') @body({"ten_toa_nha": "Tòa A", "dia_chi": "SGU"}) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateBuildingDto,@Req() r:any){return this.catalog.update('buildings',id,d,r.user);}
 @Roles('Admin') @Delete(':id') remove(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){return this.catalog.remove('buildings',id,r.user);}
}

@ApiTags('floors') @ApiBearerAuth()  @Controller('floors')
export class FloorController {
 constructor(private catalog:Catalog){}
 @Get() list(@Req() r:any,@Query() q:any){return this.catalog.list('floors',r.user,q);}
 @Get(':id') async get(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){const found=await this.catalog.get('floors',id,r.user);return this.catalog.present('floors',found);}
 @Roles('Admin') @Post() @body({"ma_toa_nha": "11111111-1111-4111-8111-111111111111", "so_tang": 2}) create(@Body() d:FloorDto,@Req() r:any){return this.catalog.create('floors',d,r.user);}
 @Roles('Admin') @Patch(':id') @body({"ma_toa_nha": "11111111-1111-4111-8111-111111111111", "so_tang": 2}) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateFloorDto,@Req() r:any){return this.catalog.update('floors',id,d,r.user);}
 @Roles('Admin') @Delete(':id') remove(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){return this.catalog.remove('floors',id,r.user);}
}

@ApiTags('rooms') @ApiBearerAuth()  @Controller('rooms')
export class RoomController {
 constructor(private catalog:Catalog){}
 @Get() list(@Req() r:any,@Query() q:any){return this.catalog.list('rooms',r.user,q);}
 @Get(':id') async get(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){const found=await this.catalog.get('rooms',id,r.user);return this.catalog.present('rooms',found);}
 @Roles('Admin') @Post() @body({"ma_tang": "22222222-2222-4222-8222-222222222222", "ten_phong": "A102", "loai_phong": "CLASSROOM"}) create(@Body() d:RoomDto,@Req() r:any){return this.catalog.create('rooms',d,r.user);}
 @Roles('Admin') @Patch(':id') @body({"ma_tang": "22222222-2222-4222-8222-222222222222", "ten_phong": "A102", "loai_phong": "CLASSROOM"}) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateRoomDto,@Req() r:any){return this.catalog.update('rooms',id,d,r.user);}
 @Roles('Admin') @Delete(':id') remove(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){return this.catalog.remove('rooms',id,r.user);}
}

@ApiTags('devices') @ApiBearerAuth()  @Controller('devices')
export class DeviceController {
 constructor(private catalog:Catalog){}
 @Get() list(@Req() r:any,@Query() q:any){return this.catalog.list('devices',r.user,q);}
 @Get(':id') async get(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){const found=await this.catalog.get('devices',id,r.user);return this.catalog.present('devices',found);}
 @Roles('Admin') @Post() @body({"ma_phong": "33333333-3333-4333-8333-333333333333", "ten_thiet_bi": "ESP32", "dia_chi_mac": "AA:BB:CC:DD:EE:FF", "chu_de_mqtt": "campus/mydevice", "cho_phep_dieu_khien": true, "cong_suat_dinh_muc": 2000, "chu_ky_gui": 5}) create(@Body() d:DeviceDto,@Req() r:any){return this.catalog.create('devices',d,r.user);}
 @Roles('Admin') @Patch(':id') @body({"ma_phong": "33333333-3333-4333-8333-333333333333", "ten_thiet_bi": "ESP32", "dia_chi_mac": "AA:BB:CC:DD:EE:FF", "chu_de_mqtt": "campus/mydevice", "cho_phep_dieu_khien": true, "cong_suat_dinh_muc": 2000, "chu_ky_gui": 5}) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateDeviceDto,@Req() r:any){return this.catalog.update('devices',id,d,r.user);}
 @Roles('Admin') @Delete(':id') remove(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){return this.catalog.remove('devices',id,r.user);}
}

@ApiTags('users') @ApiBearerAuth() @Roles('Admin') @Controller('users')
export class UserController {
 constructor(private catalog:Catalog){}
 @Get() list(@Req() r:any,@Query() q:any){return this.catalog.list('users',r.user,q);}
 @Get(':id') async get(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){const found=await this.catalog.get('users',id,r.user);return publicUser(found);}
 @Roles('Admin') @Post() @body({"tai_khoan": "viewer2", "mat_khau": "ChangeThis_12345", "ho_ten": "Người xem", "vai_tro": "NguoiXem", "buildingIds": ["11111111-1111-4111-8111-111111111111"], "active": true}) create(@Body() d:UserDto,@Req() r:any){return this.catalog.create('users',d,r.user);}
 @Roles('Admin') @Patch(':id') @body({"tai_khoan": "viewer2", "mat_khau": "ChangeThis_12345", "ho_ten": "Người xem", "vai_tro": "NguoiXem", "buildingIds": ["11111111-1111-4111-8111-111111111111"], "active": true}) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateUserDto,@Req() r:any){return this.catalog.update('users',id,d,r.user);}
 @Roles('Admin') @Delete(':id') remove(@Param('id',ParseUUIDPipe) id:string,@Req() r:any){return this.catalog.remove('users',id,r.user);}
}
export const catalogControllers=[BuildingController,FloorController,RoomController,DeviceController,UserController];
