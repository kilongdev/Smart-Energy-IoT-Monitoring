import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { compare } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

import { Database } from './database';
import { LoginDto } from './dto';
import { publicUser, Role, User } from './domain';

export const Public = () => SetMetadata('public', true);

export const Roles = (...roles: Role[]) =>
  SetMetadata('roles', roles);

@Injectable()
export class Security {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  async authenticate(token?: string): Promise<User> {
    if (!token) {
      throw new UnauthorizedException('Vui lòng đăng nhập');
    }

    try {
      const claims = await this.jwt.verifyAsync(token);

      const user = await this.db.collection('users').findOne({
        _id: claims.sub,
        active: true,
      });

      if (!user || (user.tokenVersion || 0) !== claims.v) {
        throw new Error();
      }

      return user as unknown as User;
    } catch {
      throw new UnauthorizedException(
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn',
      );
    }
  }

  sign(user: any) {
    return this.jwt.signAsync(
      {
        sub: user._id,
        v: user.tokenVersion || 0,
      },
      {
        expiresIn: '8h',
      },
    );
  }

  buildingFilter(user: User) {
    return user.vai_tro === 'Admin'
      ? {}
      : { buildingId: { $in: user.buildingIds } };
  }

  checkBuilding(user: User, buildingId: string) {
    if (
      user.vai_tro !== 'Admin' &&
      !user.buildingIds.includes(buildingId)
    ) {
      throw new ForbiddenException(
        'Không có quyền truy cập tòa nhà này',
      );
    }
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: Security,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride('public', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const match = /^Bearer (.+)$/.exec(
      request.headers.authorization || '',
    );

    request.user = await this.security.authenticate(match?.[1]);

    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (roles && !roles.includes(request.user.vai_tro)) {
      throw new ForbiddenException(
        'Vai trò không được phép thực hiện',
      );
    }

    return true;
  }
}

@ApiTags('Xác thực')
@Controller('auth')
export class AuthController {
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(
    private readonly db: Database,
    private readonly security: Security,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['tai_khoan', 'mat_khau'],
      properties: {
        tai_khoan: {
          type: 'string',
          example: 'admin',
        },
        mat_khau: {
          type: 'string',
          example: 'Mật khẩu trong .env',
        },
      },
    },
  })
  async login(@Body() dto: LoginDto, @Req() request: any) {
    const key = request.ip;
    const now = Date.now();

    for (const [attemptKey, value] of this.attempts) {
      if (value.until < now) {
        this.attempts.delete(attemptKey);
      }
    }

    let attempt = this.attempts.get(key);

    if (!attempt) {
      attempt = {
        count: 0,
        until: now + 60_000,
      };

      this.attempts.set(key, attempt);
    }

    attempt.count++;

    if (attempt.count > 15) {
      throw new HttpException('Thử lại sau một phút', 429);
    }

    const user = await this.db.collection('users').findOne({
      tai_khoan: dto.tai_khoan,
      active: true,
    });

    if (!user || !(await compare(dto.mat_khau, user.mat_khau))) {
      throw new UnauthorizedException(
        'Sai tài khoản hoặc mật khẩu',
      );
    }

    return {
      access_token: await this.security.sign(user),
      user: publicUser(user),
    };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@Req() request: any) {
    return publicUser(request.user);
  }
}