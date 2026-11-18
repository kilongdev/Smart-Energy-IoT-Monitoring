import { createConnection } from 'node:net';

// Check before Nest bootstrap connects MQTT. An occupied web port must not
// start a second MQTT client that disconnects the already-running backend.
export async function assertLocalPortAvailable(port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`Cổng ${port} đang được sử dụng. Dừng API Docker hoặc backend Node đang chạy trước khi khởi động bản khác.`));
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(); else reject(error);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Không xác minh được cổng ${port}; chưa khởi động kết nối MQTT.`));
    });
  });
}
