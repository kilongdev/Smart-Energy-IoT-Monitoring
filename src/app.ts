import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import {
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import helmet from 'helmet';

import { Alerts } from './alerts';
import {
  AlertController,
  ControlController,
  MonitoringController,
} from './api';
import { Analytics } from './analytics';
import { Catalog } from './catalog';
import { catalogControllers } from './catalog.controllers';
import { Control } from './control';
import { Database } from './database';
import { Events, RealtimeGateway } from './events';
import { Mqtt } from './mqtt';
import { Schedules } from './schedules';
import { Security, AccessGuard, AuthController } from './security';
import { Seed } from './seed';
import { Telemetry } from './telemetry';

@Catch()
class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    let status = 500;
    let message: any = 'Lỗi hệ thống';

    if (error instanceof HttpException) {
      status = error.getStatus();

      const data = error.getResponse();
      message =
        typeof data === 'string' ? data : (data as any).message;
    } else if (error.code === 11000) {
      status = 409;
      message = 'Dữ liệu bị trùng với bản ghi đã tồn tại';
    } else {
      new Logger('Errors').error(error.message, error.stack);
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        if (
          !process.env.JWT_SECRET ||
          process.env.JWT_SECRET.length < 32
        ) {
          throw new Error('JWT_SECRET phải có ít nhất 32 ký tự');
        }

        return {
          secret: process.env.JWT_SECRET,
        };
      },
    }),
  ],
  controllers: [
    AuthController,
    MonitoringController,
    AlertController,
    ControlController,
    ...catalogControllers,
  ],
  providers: [
    Database,
    Security,
    Events,
    RealtimeGateway,
    Catalog,
    Analytics,
    Alerts,
    Telemetry,
    Mqtt,
    Control,
    Schedules,
    Seed,
    {
      provide: APP_GUARD,
      useClass: AccessGuard,
    },
  ],
})
export class AppModule {}

export async function createApp() {
  const app =
    await NestFactory.create<NestExpressApplication>(AppModule, {
      logger:
        process.env.NODE_ENV === 'test'
          ? ['error']
          : ['log', 'warn', 'error'],
    });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'connect-src': ["'self'", 'ws:', 'wss:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.useGlobalFilters(new Errors());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');

  const schema = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Smart Energy IoT API')
      .setDescription(
        'NestJS + MongoDB. UUID và trường tiếng Việt theo báo cáo. ' +
          'Lệnh điều khiển trả 202; dùng nhật ký/WebSocket để nhận kết quả ACK.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );

  // Swagger's generated bootstrap script is inline; only /docs needs this relaxation.
  app.use('/docs', (request: any, response: any, next: any) => {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:;",
    );

    next();
  });

  SwaggerModule.setup('docs', app, schema, {
    swaggerOptions: {
      persistAuthorization: false,
    },
  });

  app.useStaticAssets(join(process.cwd(), 'public'));
  app.enableShutdownHooks();

  return app;
}