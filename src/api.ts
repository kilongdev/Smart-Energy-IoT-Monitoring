import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { Alerts } from './alerts';
import { Analytics } from './analytics';
import { Catalog } from './catalog';
import { Control } from './control';
import { Database } from './database';
import {
  AlertStateDto,
  HistoryDto,
  RangeDto,
  RuleDto,
  ScheduleDto,
  SwitchDto,
  TelemetryDto,
  UpdateRuleDto,
  UpdateScheduleDto,
} from './dto';
import { Mqtt } from './mqtt';
import { Schedules } from './schedules';
import { Public, Roles, Security } from './security';
import { Telemetry } from './telemetry';

const manager = () => Roles('Admin', 'QuanLy');

export const body = (example: any) =>
  ApiBody({
    schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(example).map(([key, value]) => [
          key,
          {
            type: Array.isArray(value) ? 'array' : typeof value,
            example: value,
            ...(Array.isArray(value)
              ? { items: { type: 'string' } }
              : {}),
          },
        ]),
      ),
    },
  });

@ApiTags('Giám sát')
@ApiBearerAuth()
@Controller()
export class MonitoringController {
  constructor(
    private readonly analytics: Analytics,
    private readonly telemetry: Telemetry,
    private readonly catalog: Catalog,
    private readonly db: Database,
    private readonly mqtt: Mqtt,
  ) {}

  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      mqtt: this.mqtt.connected,
    };
  }

  @Get('dashboard')
  dashboard(@Req() request: any) {
    return this.analytics.dashboard(request.user);
  }

  @Get('rooms/:id/heatmap')
  async heatmap(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    await this.catalog.get('rooms', id, request.user);

    return (await this.analytics.dashboard(request.user)).heatmap.find(
      (item) => item.ma_phong === id,
    );
  }

  @Roles('Admin')
  @Post('telemetry/ingest')
  @body({
    ma_thiet_bi: '44444444-4444-4444-8444-444444444444',
    thoi_gian_do: '2026-10-15T08:00:00Z',
    cong_suat_w: 620,
    dien_ap_v: 220,
    dong_dien_a: 2.8,
    nhiet_do_c: 32,
    trang_thai_relay: true,
  })
  async ingest(@Body() dto: TelemetryDto) {
    return this.telemetry.ingest(dto);
  }

  @Get('telemetry/device/:id/history')
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'cursor', required: false })
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoryDto,
    @Req() request: any,
  ) {
    return this.analytics.history(
      id,
      query.from,
      query.to,
      request.user,
      query.cursor,
    );
  }

  @Get('analytics/energy')
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({
    name: 'period',
    enum: ['day', 'week', 'month'],
    required: false,
  })
  @ApiQuery({ name: 'buildingId', required: false })
  @ApiQuery({ name: 'ma_phong', required: false })
  energy(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('period') period: string,
    @Query('buildingId') buildingId: string,
    @Query('ma_phong') roomId: string,
    @Req() request: any,
  ) {
    return this.analytics.energy(
      from,
      to,
      period || 'day',
      request.user,
      buildingId,
      roomId,
    );
  }

  @Roles('Admin')
  @Get('audit')
  audit() {
    return this.db
      .collection('audit')
      .find()
      .sort({ at: -1 })
      .limit(200)
      .toArray();
  }
}

@ApiTags('Cảnh báo')
@ApiBearerAuth()
@manager()
@Controller('alerts')
export class AlertController {
  constructor(private readonly alerts: Alerts) {}

  @Get('rules')
  rules(@Req() request: any) {
    return this.alerts.rules(request.user);
  }

  @Post('rules')
  @body({
    ma_thiet_bi: '44444444-4444-4444-8444-444444444444',
    ten_quy_tac: 'Quá tải',
    chi_so_can_do: 'cong_suat_w',
    toan_tu: '>',
    gia_tri_nguong: 1000,
    thoi_gian_duy_tri: 10,
    cooldown: 60,
    muc_do: 'HIGH',
    bat: true,
  })
  create(@Body() dto: RuleDto, @Req() request: any) {
    return this.alerts.saveRule(dto, request.user);
  }

  @Patch('rules/:id')
  @body({ bat: false })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRuleDto,
    @Req() request: any,
  ) {
    return this.alerts.saveRule(dto, request.user, id);
  }

  @Get('history')
  history(@Req() request: any, @Query() query: any) {
    return this.alerts.history(request.user, query);
  }

  @Patch('history/:id/status')
  @body({
    trang_thai: 'Đã xác nhận',
    ghi_chu: 'Đã tiếp nhận sự cố',
  })
  state(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AlertStateDto,
    @Req() request: any,
  ) {
    return this.alerts.transition(id, dto, request.user);
  }
}

@ApiTags('Điều khiển và hẹn giờ')
@ApiBearerAuth()
@manager()
@Controller('control')
export class ControlController {
  constructor(
    private readonly control: Control,
    private readonly schedules: Schedules,
    private readonly db: Database,
    private readonly security: Security,
  ) {}

  @Post('devices/:id/switch')
  @HttpCode(202)
  @body({ hanh_dong: 'Tắt' })
  switch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SwitchDto,
    @Req() request: any,
  ) {
    return this.control.send(id, dto.hanh_dong, request.user);
  }

  @Get('logs')
  logs(@Req() request: any) {
    return this.control.logs(request.user);
  }

  @Get('schedules')
  list(@Req() request: any) {
    return this.schedules.list(request.user);
  }

  @Post('schedules')
  @body({
    ma_thiet_bi: '44444444-4444-4444-8444-444444444444',
    hanh_dong: 'Tắt',
    gio_bat_dau: '17:00:00',
    ngay_lap_lai: 'T2,T3,T4,T5,T6',
    bat: true,
  })
  create(@Body() dto: ScheduleDto, @Req() request: any) {
    return this.schedules.save(dto, request.user);
  }

  @Patch('schedules/:id')
  @body({ bat: false })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @Req() request: any,
  ) {
    return this.schedules.save(dto, request.user, id);
  }

  @Delete('schedules/:id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: any,
  ) {
    return this.schedules.remove(id, request.user);
  }

  @Get('runs')
  runs(@Req() request: any) {
    return this.db
      .collection('schedule_runs')
      .find(this.security.buildingFilter(request.user))
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
  }
}