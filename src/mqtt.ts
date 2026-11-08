import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mqtt, { MqttClient } from 'mqtt';

import { Database } from './database';
import { AckDto, TelemetryDto } from './dto';
import { Events } from './events';
import { Telemetry } from './telemetry';

@Injectable()
export class Mqtt implements OnApplicationBootstrap, OnModuleDestroy {
  client?: MqttClient;

  private readonly log = new Logger('MQTT');

  ackHandler?: (dto: AckDto, topic: string) => Promise<any>;

  constructor(
    private readonly telemetry: Telemetry,
    private readonly db: Database,
    private readonly events: Events,
  ) {
    this.events.on('device-config', (device) => {
      this.publishConfig(device).catch((error) => {
        this.log.warn(error.message);
      });
    });
  }

  get connected() {
    return !!this.client?.connected;
  }

  onApplicationBootstrap() {
    if (process.env.MQTT_DISABLED === 'true') {
      return;
    }

    if (!process.env.MQTT_URL) throw new Error('Thiếu MQTT_URL của EMQX trong cấu hình.');
    this.client = mqtt.connect(
      process.env.MQTT_URL,
      {
        clientId: 'smart-energy-backend',
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        clean: false,
        reconnectPeriod: 2000,
        connectTimeout: 5000,
        queueQoSZero: false,
      },
    );

    this.client.on('connect', async () => {
      this.log.log('MQTT đã kết nối');
      this.client!.subscribe('campus/#', { qos: 1 });

      try {
        const devices = await this.db
          .collection('devices')
          .find()
          .toArray();

        for (const device of devices) {
          await this.publishConfig(device);
        }
      } catch (error: any) {
        this.log.error(error.message);
      }
    });

    this.client.on('error', (error) => {
      this.log.warn(error.message);
    });

    // MQTT.js invokes handleMessage before sending the QoS 1 PUBACK.
    // A DB error closes the connection without acknowledging so a
    // persistent session can replay.
    this.client.handleMessage = (packet, done) => {
      const topic = packet.topic;

      if (
        !topic.endsWith('/telemetry') &&
        !topic.endsWith('/ack')
      ) {
        return done();
      }

      (async () => {
        if (packet.retain) {
          throw new BadRequestException(
            'Không nhận telemetry/ACK retained',
          );
        }

        if (packet.payload.length > 4096) {
          throw new BadRequestException(
            'Payload vượt 4096 bytes',
          );
        }

        let json: any;

        try {
          json = JSON.parse(packet.payload.toString());
        } catch {
          throw new BadRequestException('JSON không hợp lệ');
        }

        const dto = topic.endsWith('/ack')
          ? plainToInstance(AckDto, json)
          : plainToInstance(TelemetryDto, json);

        const errors = await validate(dto, {
          whitelist: true,
          forbidNonWhitelisted: true,
          forbidUnknownValues: true,
        });

        if (errors.length) {
          throw new BadRequestException(
            errors.map((error) => error.property).join(', '),
          );
        }

        if (topic.endsWith('/ack')) {
          // ACK hiếm nên giữ await để giữ thứ tự trước khi PUBACK.
          await this.ackHandler?.(dto as AckDto, topic);
          done();
        } else {
          // Telemetry 15 gateway dồn cùng lúc: PUBACK ngay sau khi DTO
          // hợp lệ rồi xử lý ingest nền, tránh hàng đợi MQTT nối tiếp
          // làm bản tin sau chờ bản tin trước 10-20s. Bản tin lỗi DB
          // vẫn nằm ở telemetry (processed:false) và được replay 5s/lần.
          const copy = { ...json };
          const telemetryTopic = topic;
          done();
          await this.telemetry.ingest(copy, telemetryTopic).catch(async (ingestError) => {
            if (ingestError instanceof HttpException) {
              await this.db
                .audit('INVALID_MQTT', {
                  topic: telemetryTopic,
                  error: ingestError.message,
                })
                .catch(() => {});
            } else {
              this.log.error('Lỗi xử lý MQTT: ' + ingestError.message);
            }
          });
        }
      })()
        .then(() => {
          // Nhánh telemetry đã done() sớm; chỉ done() ở đây cho nhánh ACK.
          if (topic.endsWith('/ack')) return;
        })
        .catch(async (error) => {
          if (error instanceof HttpException) {
            await this.db
              .audit('INVALID_MQTT', {
                topic,
                error: error.message,
              })
              .catch(() => {});

            done();
          } else {
            this.log.error(
              'Lỗi xử lý MQTT: ' + error.message,
            );

            this.client?.stream.destroy();
            done(error);
          }
        });
    };
  }

  async publish(
    topic: string,
    payload: any,
    retain = false,
  ) {
    if (!this.client?.connected) {
      throw new Error('MQTT chưa kết nối');
    }

    await this.client.publishAsync(
      topic,
      JSON.stringify(payload),
      {
        qos: 1,
        retain,
      },
    );
  }

  async publishConfig(device: any) {
    if (this.connected) {
      await this.publish(
        `${device.chu_de_mqtt}/config`,
        {
          chu_ky_gui: device.chu_ky_gui,
        },
        true,
      );
    }
  }

  async onModuleDestroy() {
    await this.client?.endAsync(true);
  }
}
