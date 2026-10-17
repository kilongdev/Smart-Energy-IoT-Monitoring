import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter } from 'node:events';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { Security } from './security';

@Injectable()
export class Events extends EventEmitter {
  send(
    buildingId: string,
    type: string,
    data: any,
    management = false,
  ) {
    this.emit('push', {
      buildingId,
      type,
      data,
      management,
    });
  }
}

@WebSocketGateway({
  transports: ['websocket'],
  maxHttpBufferSize: 8192,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly security: Security,
    private readonly events: Events,
  ) {
    this.events.on('push', (event) => {
      const rooms = event.management
        ? [`manage:${event.buildingId}`, 'manage:*']
        : [`building:${event.buildingId}`, 'building:*'];

      this.server
        ?.to(rooms)
        .emit(event.type, event.data);
    });

    this.events.on('revoke', (id: string) => {
      const sockets = this.server?.sockets.sockets.values() || [];

      for (const socket of sockets) {
        if (socket.data.user?._id === id) {
          socket.disconnect(true);
        }
      }
    });
  }

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token;
      const user = await this.security.authenticate(token);

      socket.data.user = user;

      // Admin joins all existing building rooms; new buildings trigger a reconnect event.
      let ids = user.buildingIds;

      if (user.vai_tro === 'Admin') {
        ids = ['*'];
      }

      for (const id of ids) {
        socket.join(`building:${id}`);

        if (user.vai_tro !== 'NguoiXem') {
          socket.join(`manage:${id}`);
        }
      }

      const timer = setInterval(() => {
        this.security
          .authenticate(token)
          .catch(() => socket.disconnect(true));
      }, 30_000);

      this.timers.set(socket.id, timer);

      socket.on('disconnect', () => {
        clearInterval(timer);
        this.timers.delete(socket.id);
      });
    } catch {
      socket.disconnect(true);
    }
  }

  onModuleDestroy() {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
  }
}