import 'reflect-metadata';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Alerts } from '../src/alerts';
import { sendTelegram, telegramAlertText, TelegramError } from '../src/telegram';
import { MemoryStore } from './memory-store';

const oldToken = process.env.TELEGRAM_BOT_TOKEN;
const oldChat = process.env.TELEGRAM_CHAT_ID;
beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = '123:test-secret';
  process.env.TELEGRAM_CHAT_ID = '-100123';
});
afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of [['TELEGRAM_BOT_TOKEN', oldToken], ['TELEGRAM_CHAT_ID', oldChat]]) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
});
const response = (data: any, status = 200) => new Response(JSON.stringify(data), { status });
function fixture() {
  const db = new MemoryStore();
  const events: any[] = [];
  const service = new Alerts(db as any, { send: (...args: any[]) => events.push(args) } as any, {} as any, {} as any);
  return { db, service, events };
}
async function enqueue(db: MemoryStore, extra: any = {}) {
  await db.collection('alerts').insertOne({
    _id: 'alert1', buildingId: 'b1', ma_quy_tac: 'r1',
    notificationId: 'notification1', notificationText: 'Cảnh báo quá tải',
    notificationKind: 'detected', initialDeliveryStatus: 'PENDING',
    trang_thai: 'Mới', tinh_trang: 'Đang diễn ra',
    trang_thai_gui: 'Đang chờ', nextRetry: new Date(0), attempts: 0, cooldown: 60,
    ...extra,
  });
}

test('Telegram sends plain text to the configured chat and checks message_id', async () => {
  const fetch = mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    assert.equal(body.chat_id, '-100123');
    assert.equal(body.text.length, 4000);
    assert.equal(body.parse_mode, undefined);
    return response({ ok: true, result: { message_id: 42 } });
  });
  assert.equal(await sendTelegram('<>&'.repeat(2000)), 42);
  assert.equal(fetch.mock.callCount(), 1);
});

test('Telegram rejects API errors, malformed responses and network failures without exposing token', async () => {
  const fetch = mock.method(globalThis, 'fetch');
  for (const code of [400, 401, 403, 429, 500]) {
    fetch.mock.mockImplementation(async () => response({ ok: false, error_code: code, description: '123:test-secret', parameters: { retry_after: 120 } }, code));
    await assert.rejects(sendTelegram('test'), (error: any) => {
      assert.ok(error instanceof TelegramError);
      assert.match(error.message, new RegExp(String(code)));
      assert.ok(!error.message.includes('test-secret'));
      assert.equal(error.retryAfter, 120);
      return true;
    });
  }
  fetch.mock.mockImplementation(async () => { throw new Error('https://api.telegram.org/bot123:test-secret'); });
  await assert.rejects(sendTelegram('test'), /Không kết nối được Telegram/);
  fetch.mock.mockImplementation(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
  await assert.rejects(sendTelegram('test'), /phản hồi không hợp lệ/);
  fetch.mock.mockImplementation(async () => response({ ok: true, result: {} }));
  await assert.rejects(sendTelegram('test'), /mã tin nhắn/);
  fetch.mock.mockImplementation(async () => response({ ok: false, error_code: 400 }));
  await assert.rejects(sendTelegram('test'), /Telegram 400/);
});

test('Alert text includes location, units, threshold and Vietnam time', () => {
  const text = telegramAlertText({ ten_thiet_bi: 'ESP32' }, {
    ten_quy_tac: 'Quá tải', chi_so_can_do: 'cong_suat_w', toan_tu: '>',
    gia_tri_nguong: 1000, thoi_gian_duy_tri: 10, muc_do: 'HIGH',
  }, { cong_suat_w: 1600, thoi_gian_do: '2026-11-05T03:00:00Z' }, 'Tòa A / Phòng A101', 'id1');
  for (const part of ['ESP32', 'Tòa A / Phòng A101', '1600 W', '> 1000 W', '10:00:00', 'id1']) assert.ok(text.includes(part), text);
});

test('Missing config consumes no attempts and pending alert resumes after configuration', async () => {
  const { db, service, events } = fixture();
  await enqueue(db);
  const fetch = mock.method(globalThis, 'fetch', async () => response({ ok: true, result: { message_id: 7 } }));
  process.env.TELEGRAM_CHAT_ID = '';
  await service.notifications();
  let row = await db.collection('alerts').findOne();
  assert.equal(row.trang_thai_gui, 'Chưa cấu hình');
  assert.equal(row.attempts, 0);
  assert.equal(fetch.mock.callCount(), 0);
  process.env.TELEGRAM_CHAT_ID = '-100123';
  await service.notifications();
  row = await db.collection('alerts').findOne();
  assert.equal(row.trang_thai_gui, 'Thành công');
  assert.equal(row.telegramMessageId, 7);
  assert.equal(row.attempts, 1);
  assert.equal(events.length, 1);
});

test('429 persists retry_after and pauses other notifications', async () => {
  const { db, service } = fixture();
  await enqueue(db);
  await enqueue(db, { _id: 'alert2' });
  const fetch = mock.method(globalThis, 'fetch', async () => response({ ok: false, error_code: 429, parameters: { retry_after: 120 } }, 429));
  const start = Date.now();
  await service.notifications();
  const row = await db.collection('alerts').findOne({ _id: 'alert1' });
  assert.equal(row.trang_thai_gui, 'Thất bại');
  assert.ok(+row.nextRetry >= start + 120000);
  assert.equal(row.attempts, 1);
  await service.notifications();
  assert.equal(fetch.mock.callCount(), 1);
});

test('Failures retry at most three times per notification, including after worker restart', async () => {
  const { db } = fixture();
  await enqueue(db);
  const fetch = mock.method(globalThis, 'fetch', async () => response({ ok: false }, 500));
  for (let attempt = 0; attempt < 4; attempt++) {
    await db.collection('alerts').updateOne({ _id: 'alert1' }, { $set: { nextRetry: new Date(0) } });
    const worker = new Alerts(db as any, { send() {} } as any, {} as any, {} as any);
    await worker.notifications();
  }
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal((await db.collection('alerts').findOne()).attempts, 3);
});

test('Concurrent workers claim the same notification once and pace a backlog', async () => {
  const { db, service } = fixture();
  await enqueue(db);
  const fetch = mock.method(globalThis, 'fetch', async () => response({ ok: true, result: { message_id: 9 } }));
  const other = new Alerts(db as any, { send() {} } as any, {} as any, {} as any);
  await Promise.all([service.notifications(), other.notifications(), service.notifications()]);
  assert.equal(fetch.mock.callCount(), 1);
  await enqueue(db, { _id: 'alert2' });
  await service.notifications();
  assert.equal(fetch.mock.callCount(), 1);
});

test('Ended incidents are not sent; expired worker leases can be retried', async () => {
  const { db, service } = fixture();
  await enqueue(db, { tinh_trang: 'Đã kết thúc', notificationKind: 'reminder' });
  await enqueue(db, { _id: 'resolved', trang_thai: 'Đã phục hồi', notificationKind: 'reminder' });
  await enqueue(db, { _id: 'alert2', sendingUntil: new Date(0), deliveryLease: 'old-worker' });
  const fetch = mock.method(globalThis, 'fetch', async () => response({ ok: true, result: { message_id: 9 } }));
  await service.notifications();
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await db.collection('alerts').findOne({ _id: 'alert1' })).attempts, 0);
  assert.equal((await db.collection('alerts').findOne({ _id: 'alert2' })).trang_thai_gui, 'Thành công');
});

test('Telemetry queues a readable notification and cannot overwrite retry_after at cooldown', async () => {
  const { db, service } = fixture();
  const now = new Date();
  const device = { _id: 'd1', ten_thiet_bi: 'ESP32', buildingId: 'b1', ma_phong: 'p1', chu_ky_gui: 5 };
  await db.collection('rooms').insertOne({ _id: 'p1', ten_phong: 'A101' });
  await db.collection('buildings').insertOne({ _id: 'b1', ten_toa_nha: 'Tòa A' });
  await db.collection('rules').insertOne({ _id: 'r1', ma_thiet_bi: 'd1', bat: true, updatedAt: now,
    ten_quy_tac: 'Quá tải', chi_so_can_do: 'cong_suat_w', toan_tu: '>', gia_tri_nguong: 1000,
    thoi_gian_duy_tri: 0, cooldown: 0, muc_do: 'HIGH' });
  const sample = { thoi_gian_do: now, receivedAt: now, cong_suat_w: 1600 };
  await service.evaluate(device, sample);
  let row = await db.collection('alerts').findOne();
  assert.match(row.notificationText, /Tòa A \/ A101/);
  assert.match(row.notificationText, /1600 W/);
  const notificationId = row.notificationId;
  const future = new Date(Date.now() + 120000);
  await db.collection('alerts').updateOne({ _id: row._id }, { $set: { trang_thai_gui: 'Thất bại', attempts: 2, nextRetry: future } });
  await service.evaluate(device, { ...sample, thoi_gian_do: new Date(+now + 1), receivedAt: new Date(+now + 1), cong_suat_w: 1700 });
  row = await db.collection('alerts').findOne();
  assert.equal(row.notificationId, notificationId);
  assert.equal(row.attempts, 2);
  assert.equal(+row.nextRetry, +future);
  await db.collection('alerts').updateOne({ _id: row._id }, { $set: { attempts: 3 } });
  await service.evaluate(device, { ...sample, thoi_gian_do: new Date(+now + 2), receivedAt: new Date(+now + 2) });
  row = await db.collection('alerts').findOne();
  assert.equal(row.notificationId, notificationId);
  assert.equal(row.attempts, 3);
  await service.evaluate(device, { ...sample, thoi_gian_do: new Date(+now + 3), receivedAt: new Date(+now + 3), cong_suat_w: 500 });
  row = await db.collection('alerts').findOne();
  assert.equal(row.tinh_trang, 'Đang phục hồi');
  for (const ms of [10003, 20003, 30003]) {
    await service.evaluate(device, { ...sample, thoi_gian_do: new Date(+now + ms), receivedAt: new Date(+now + ms), cong_suat_w: 500 });
  }
  row = await db.collection('alerts').findOne();
  assert.equal(row.tinh_trang, 'Đã kết thúc');
  assert.equal(row.trang_thai, 'Đã phục hồi');
});
