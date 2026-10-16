import {Injectable,CanActivate,ExecutionContext,SetMetadata,UnauthorizedException,ForbiddenException,Controller,Post,Body,Get,Req,HttpCode,HttpException} from '@nestjs/common';
import {Reflector} from '@nestjs/core';import {JwtService} from '@nestjs/jwt';import {compare} from 'bcryptjs';
import {Database} from './database';import {User,Role,publicUser} from './domain';import {LoginDto} from './dto';
import {ApiBearerAuth,ApiTags,ApiBody} from '@nestjs/swagger';
export const Public=()=>SetMetadata('public',true);
export const Roles=(...roles:Role[])=>SetMetadata('roles',roles);
@Injectable()
export class Security {
 constructor(private db:Database,private jwt:JwtService){}
 async authenticate(token?:string):Promise<User>{
  if(!token)throw new UnauthorizedException('Vui lòng đăng nhập');
  try {const claims=await this.jwt.verifyAsync(token);const u=await this.db.collection('users').findOne({_id:claims.sub,active:true});
   if(!u || (u.tokenVersion||0)!==claims.v)throw new Error();return u as unknown as User;
  }catch{throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn');}
 }
 sign(u:any){return this.jwt.signAsync({sub:u._id,v:u.tokenVersion||0},{expiresIn:'8h'});}
 buildingFilter(u:User){return u.vai_tro==='Admin'?{}:{buildingId:{$in:u.buildingIds}};}
 checkBuilding(u:User,buildingId:string){if(u.vai_tro!=='Admin'&&!u.buildingIds.includes(buildingId))throw new ForbiddenException('Không có quyền truy cập tòa nhà này');}
}
@Injectable()
export class AccessGuard implements CanActivate {
 constructor(private reflector:Reflector,private security:Security){}
 async canActivate(ctx:ExecutionContext){
  if(ctx.getType()!=='http')return true;
  if(this.reflector.getAllAndOverride('public',[ctx.getHandler(),ctx.getClass()]))return true;
  const req=ctx.switchToHttp().getRequest();const match=/^Bearer (.+)$/.exec(req.headers.authorization||'');req.user=await this.security.authenticate(match?.[1]);
  const roles=this.reflector.getAllAndOverride<Role[]>('roles',[ctx.getHandler(),ctx.getClass()]);
  if(roles&&!roles.includes(req.user.vai_tro))throw new ForbiddenException('Vai trò không được phép thực hiện');return true;
 }
}
@ApiTags('Xác thực') @Controller('auth')
export class AuthController {
 private attempts=new Map<string,{count:number,until:number}>();
 constructor(private db:Database,private security:Security){}
 @Public() @Post('login') @HttpCode(200) @ApiBody({schema:{type:'object',required:['tai_khoan','mat_khau'],properties:{tai_khoan:{type:'string',example:'admin'},mat_khau:{type:'string',example:'Mật khẩu trong .env'}}}})
 async login(@Body() dto:LoginDto,@Req() req:any){
  const key=req.ip;const now=Date.now();for(const [k,v]of this.attempts)if(v.until<now)this.attempts.delete(k);
  let a=this.attempts.get(key);if(!a){a={count:0,until:now+60000};this.attempts.set(key,a);}a.count++;
  if(a.count>15)throw new HttpException('Thử lại sau một phút',429);
  const u=await this.db.collection('users').findOne({tai_khoan:dto.tai_khoan,active:true});
  if(!u||!await compare(dto.mat_khau,u.mat_khau))throw new UnauthorizedException('Sai tài khoản hoặc mật khẩu');
  return {access_token:await this.security.sign(u),user:publicUser(u)};
 }
 @ApiBearerAuth() @Get('me') me(@Req() req:any){return publicUser(req.user);}
}
