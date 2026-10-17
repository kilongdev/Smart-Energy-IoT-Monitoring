import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';

import { body } from './api';
import { Catalog } from './catalog';
import { publicUser } from './domain';
import {
  BuildingDto,
  DeviceDto,
  FloorDto,
  RoomDto,
  UpdateBuildingDto,
  UpdateDeviceDto,
  UpdateFloorDto,
  UpdateRoomDto,
  UpdateUserDto,
  UserDto,
} from './dto';
import { Roles } from './security';

@ApiTags('buildings')
@ApiBearerAuth()
@Controller('buildings')
export class BuildingController {
  constructor(private readonly catalog: Catalog) {}

  @Get()
  list(@Req() request: any, @Query() query: any) {
    return this.catalog.list('buildings', request.user, query);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    const found = await this.catalog.get(
      'buildings',
      id,
      request.user,
    );

    return this.catalog.present('buildings', found);
  }

  @Roles('Admin')
  @Post()
  @body({ ten_toa_nha: 'Tòa A', dia_chi: 'SGU' })
  create(@Body() dto: BuildingDto, @Req() request: any) {
    return this.catalog.create('buildings', dto, request.user);
  }

  @Roles('Admin')
  @Patch(':id')
  @body({ ten_toa_nha: 'Tòa A', dia_chi: 'SGU' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuildingDto,
    @Req() request: any,
  ) {
    return this.catalog.update('buildings', id, dto, request.user);
  }

  @Roles('Admin')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    return this.catalog.remove('buildings', id, request.user);
  }
}

@ApiTags('floors')
@ApiBearerAuth()
@Controller('floors')
export class FloorController {
  constructor(private readonly catalog: Catalog) {}

  @Get()
  list(@Req() request: any, @Query() query: any) {
    return this.catalog.list('floors', request.user, query);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    const found = await this.catalog.get('floors', id, request.user);

    return this.catalog.present('floors', found);
  }

  @Roles('Admin')
  @Post()
  @body({
    ma_toa_nha: '11111111-1111-4111-8111-111111111111',
    so_tang: 2,
  })
  create(@Body() dto: FloorDto, @Req() request: any) {
    return this.catalog.create('floors', dto, request.user);
  }

  @Roles('Admin')
  @Patch(':id')
  @body({
    ma_toa_nha: '11111111-1111-4111-8111-111111111111',
    so_tang: 2,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFloorDto,
    @Req() request: any,
  ) {
    return this.catalog.update('floors', id, dto, request.user);
  }

  @Roles('Admin')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    return this.catalog.remove('floors', id, request.user);
  }
}

@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomController {
  constructor(private readonly catalog: Catalog) {}

  @Get()
  list(@Req() request: any, @Query() query: any) {
    return this.catalog.list('rooms', request.user, query);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    const found = await this.catalog.get('rooms', id, request.user);

    return this.catalog.present('rooms', found);
  }

  @Roles('Admin')
  @Post()
  @body({
    ma_tang: '22222222-2222-4222-8222-222222222222',
    ten_phong: 'A102',
    loai_phong: 'CLASSROOM',
  })
  create(@Body() dto: RoomDto, @Req() request: any) {
    return this.catalog.create('rooms', dto, request.user);
  }

  @Roles('Admin')
  @Patch(':id')
  @body({
    ma_tang: '22222222-2222-4222-8222-222222222222',
    ten_phong: 'A102',
    loai_phong: 'CLASSROOM',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
    @Req() request: any,
  ) {
    return this.catalog.update('rooms', id, dto, request.user);
  }

  @Roles('Admin')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    return this.catalog.remove('rooms', id, request.user);
  }
}

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DeviceController {
  constructor(private readonly catalog: Catalog) {}

  @Get()
  list(@Req() request: any, @Query() query: any) {
    return this.catalog.list('devices', request.user, query);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    const found = await this.catalog.get('devices', id, request.user);

    return this.catalog.present('devices', found);
  }

  @Roles('Admin')
  @Post()
  @body({
    ma_phong: '33333333-3333-4333-8333-333333333333',
    ten_thiet_bi: 'ESP32',
    dia_chi_mac: 'AA:BB:CC:DD:EE:FF',
    chu_de_mqtt: 'campus/mydevice',
    cho_phep_dieu_khien: true,
    cong_suat_dinh_muc: 2000,
    chu_ky_gui: 5,
  })
  create(@Body() dto: DeviceDto, @Req() request: any) {
    return this.catalog.create('devices', dto, request.user);
  }

  @Roles('Admin')
  @Patch(':id')
  @body({
    ma_phong: '33333333-3333-4333-8333-333333333333',
    ten_thiet_bi: 'ESP32',
    dia_chi_mac: 'AA:BB:CC:DD:EE:FF',
    chu_de_mqtt: 'campus/mydevice',
    cho_phep_dieu_khien: true,
    cong_suat_dinh_muc: 2000,
    chu_ky_gui: 5,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
    @Req() request: any,
  ) {
    return this.catalog.update('devices', id, dto, request.user);
  }

  @Roles('Admin')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    return this.catalog.remove('devices', id, request.user);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Roles('Admin')
@Controller('users')
export class UserController {
  constructor(private readonly catalog: Catalog) {}

  @Get()
  list(@Req() request: any, @Query() query: any) {
    return this.catalog.list('users', request.user, query);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    const found = await this.catalog.get('users', id, request.user);

    return publicUser(found);
  }

  @Roles('Admin')
  @Post()
  @body({
    tai_khoan: 'viewer2',
    mat_khau: 'ChangeThis_12345',
    ho_ten: 'Người xem',
    vai_tro: 'NguoiXem',
    buildingIds: ['11111111-1111-4111-8111-111111111111'],
    active: true,
  })
  create(@Body() dto: UserDto, @Req() request: any) {
    return this.catalog.create('users', dto, request.user);
  }

  @Roles('Admin')
  @Patch(':id')
  @body({
    tai_khoan: 'viewer2',
    mat_khau: 'ChangeThis_12345',
    ho_ten: 'Người xem',
    vai_tro: 'NguoiXem',
    buildingIds: ['11111111-1111-4111-8111-111111111111'],
    active: true,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: any,
  ) {
    return this.catalog.update('users', id, dto, request.user);
  }

  @Roles('Admin')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    return this.catalog.remove('users', id, request.user);
  }
}

export const catalogControllers = [
  BuildingController,
  FloorController,
  RoomController,
  DeviceController,
  UserController,
];