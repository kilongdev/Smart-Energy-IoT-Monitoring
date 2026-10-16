import {IsString,IsNotEmpty,MaxLength,MinLength,IsIn,IsUUID,IsNumber,Min,Max,IsInt,IsBoolean,IsOptional,ValidateIf,Matches,IsArray,ArrayMaxSize,IsISO8601,IsEmail} from 'class-validator';
import {PartialType} from '@nestjs/swagger';
export class LoginDto {@IsString() @MinLength(1) tai_khoan!:string; @IsString() @MinLength(1) mat_khau!:string;}
export class BuildingDto {@IsString() @IsNotEmpty() @MaxLength(120) ten_toa_nha!:string; @ValidateIf((o,v)=>v!==undefined) @IsString() @MaxLength(250) dia_chi?:string;}
export class FloorDto {@IsUUID() ma_toa_nha!:string; @IsInt() @Min(-10) @Max(200) so_tang!:number;}
export class RoomDto {@IsUUID() ma_tang!:string; @IsString() @IsNotEmpty() @MaxLength(120) ten_phong!:string; @IsIn(['CLASSROOM','OFFICE','LAB','MEETING','OTHER']) loai_phong!:string;}
export class DeviceDto {
 @IsUUID() ma_phong!:string; @IsString() @IsNotEmpty() @MaxLength(120) ten_thiet_bi!:string;
 @Matches(/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) dia_chi_mac!:string;
 @Matches(/^campus\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/) @MaxLength(160) chu_de_mqtt!:string;
 @IsBoolean() cho_phep_dieu_khien!:boolean; @ValidateIf((o,v)=>v!==undefined) @IsNumber() @Min(1) @Max(10000000) cong_suat_dinh_muc?:number;
 @ValidateIf((o,v)=>v!==undefined) @IsInt() @Min(1) @Max(60) chu_ky_gui?:number;
}
export class UserDto {
 @Matches(/^[a-zA-Z0-9_.-]{3,50}$/) tai_khoan!:string; @IsString() @MinLength(10) @MaxLength(100) mat_khau!:string;
 @IsString() @IsNotEmpty() @MaxLength(100) ho_ten!:string; @IsIn(['Admin','QuanLy','NguoiXem']) vai_tro!:'Admin'|'QuanLy'|'NguoiXem';
 @IsArray() @IsUUID('all',{each:true}) @ArrayMaxSize(100) buildingIds!:string[];
 @ValidateIf((o,v)=>v!==undefined) @IsBoolean() active?:boolean;
}
export class UpdateBuildingDto extends PartialType(BuildingDto,{skipNullProperties:false}){}
export class UpdateFloorDto extends PartialType(FloorDto,{skipNullProperties:false}){}
export class UpdateRoomDto extends PartialType(RoomDto,{skipNullProperties:false}){}
export class UpdateDeviceDto extends PartialType(DeviceDto,{skipNullProperties:false}){}
export class UpdateUserDto extends PartialType(UserDto,{skipNullProperties:false}){}
export class TelemetryDto {
 @IsUUID() ma_thiet_bi!:string;
 @IsISO8601({strict:true}) thoi_gian_do!:string;
 @IsNumber() @Min(0) @Max(10000000) cong_suat_w!:number;
 @IsNumber() @Min(0) @Max(1000) dien_ap_v!:number;
 @IsNumber() @Min(0) @Max(10000) dong_dien_a!:number;
 @IsNumber() @Min(-40) @Max(200) nhiet_do_c!:number;
 @IsBoolean() trang_thai_relay!:boolean;
}
export class AckDto {@IsUUID() ma_thiet_bi!:string;@IsUUID() ma_lenh!:string;@IsBoolean() trang_thai_relay!:boolean;@IsISO8601({strict:true}) thoi_gian!:string;@ValidateIf((o,v)=>v!==undefined) @IsString() @MaxLength(200) loi?:string;}
export class RuleDto {
 @IsUUID() ma_thiet_bi!:string;@IsString() @IsNotEmpty() @MaxLength(120) ten_quy_tac!:string;
 @IsIn(['cong_suat_w','dien_ap_v','dong_dien_a','nhiet_do_c']) chi_so_can_do!:string;
 @IsIn(['>','<','>=','<=','=']) toan_tu!:string;@IsNumber() gia_tri_nguong!:number;
 @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/) khung_gio_ap_dung?:string;
 @ValidateIf((o,v)=>v!==undefined) @IsInt() @Min(0) @Max(86400) thoi_gian_duy_tri?:number;
 @ValidateIf((o,v)=>v!==undefined) @IsInt() @Min(5) @Max(604800) cooldown?:number;
 @ValidateIf((o,v)=>v!==undefined) @IsIn(['LOW','MEDIUM','HIGH']) muc_do?:string;@ValidateIf((o,v)=>v!==undefined) @IsBoolean() bat?:boolean;
}
export class UpdateRuleDto extends PartialType(RuleDto,{skipNullProperties:false}){}
export class SwitchDto {@IsIn(['Bật','Tắt']) hanh_dong!:'Bật'|'Tắt';}
export class ScheduleDto {
 @IsUUID() ma_thiet_bi!:string;@IsIn(['Bật','Tắt']) hanh_dong!:'Bật'|'Tắt';
 @Matches(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/) gio_bat_dau!:string;
 @Matches(/^(T[2-7]|CN)(,(T[2-7]|CN))*$/) ngay_lap_lai!:string;
 @ValidateIf((o,v)=>v!==undefined) @IsBoolean() bat?:boolean;
}
export class UpdateScheduleDto extends PartialType(ScheduleDto,{skipNullProperties:false}){}
export class AlertStateDto {@IsIn(['Đã xác nhận','Đã xử lý']) trang_thai!:string;@ValidateIf((o,v)=>v!==undefined) @IsString() @MaxLength(1000) ghi_chu?:string;}
export class RangeDto {@IsISO8601({strict:true}) from!:string;@IsISO8601({strict:true}) to!:string;}
export class HistoryDto extends RangeDto {@ValidateIf((o,v)=>v!==undefined) @IsString() cursor?:string;}
