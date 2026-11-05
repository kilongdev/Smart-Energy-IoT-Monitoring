import 'reflect-metadata';
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Alerts } from '../src/alerts';
import { MemoryStore } from './memory-store';

afterEach(() => mock.restoreAll());
async function setup(extra: any = {}) {
  const db = new MemoryStore();
  const device = { _id: 'd', buildingId: 'b', ma_phong: 'p', ten_thiet_bi: 'ESP32', chu_ky_gui: 5 };
  const rule = { _id: 'r', ma_thiet_bi: 'd', ten_quy_tac: 'Tăng áp', chi_so_can_do: 'dien_ap_v',
    toan_tu: '>', gia_tri_nguong: 240, thoi_gian_duy_tri: 0, thoi_gian_phuc_hoi: 30,
    cooldown: 300, bat: true, muc_do: 'HIGH', updatedAt: new Date(), ...extra };
  await db.collection('rules').insertOne(rule);
  const events: any[] = [];
  const service = new Alerts(db as any, { send: (...args: any[]) => events.push(args) } as any,
    { get: async () => device } as any, { checkBuilding() {} } as any);
  const origin = Date.now();
  const sample = (seconds: number, voltage = 220) => ({ thoi_gian_do: new Date(origin + seconds * 1000),
    receivedAt: new Date(origin + seconds * 1000), dien_ap_v: voltage });
  const measure = (seconds: number, voltage = 220) => service.evaluate(device, sample(seconds, voltage));
  const alert = () => db.collection('alerts').findOne({ ma_quy_tac: 'r' });
  return { db, device, rule, service, measure, sample, alert, events };
}

test('Recovery needs continuous normal readings and queues exactly one recovery notification', async () => {
  const f = await setup();
  await f.measure(0, 250);
  assert.equal((await f.alert()).notificationKind, 'detected');
  await f.measure(5);
  assert.equal((await f.alert()).tinh_trang, 'Đang phục hồi');
  for (const t of [10, 15, 20, 25, 30]) await f.measure(t);
  assert.equal((await f.alert()).trang_thai, 'Đang theo dõi');
  await f.measure(35);
  const ended = await f.alert();
  assert.equal(ended.resolvedBy, 'system');
  assert.equal(ended.trang_thai, 'Đã phục hồi');
  assert.match(ended.recoveryNotification.notificationText, /THÔNG SỐ ĐÃ PHỤC HỒI/);
  assert.match(ended.recoveryNotification.notificationText, /220 V/);
  assert.equal(ended.recoveryNotification.notificationKind, 'recovered');
  await f.measure(40);
  assert.equal((await f.alert()).recoveryNotification.notificationId, ended.recoveryNotification.notificationId);
  assert.equal(await f.db.collection('alerts').countDocuments(), 1);
  await f.measure(45, 250);
  assert.equal(await f.db.collection('alerts').countDocuments(), 2);
});

test('A spike during recovery resets recovery without creating another incident', async () => {
  const f = await setup();
  await f.measure(0, 250);
  await f.measure(5); await f.measure(15); await f.measure(25, 250);
  assert.equal((await f.alert()).recoverySince, null);
  assert.equal((await f.alert()).tinh_trang, 'Đang diễn ra');
  for (const t of [30, 40, 50]) await f.measure(t);
  assert.equal((await f.alert()).tinh_trang, 'Đang phục hồi');
  await f.measure(60);
  assert.equal((await f.alert()).tinh_trang, 'Đã kết thúc');
  assert.equal(await f.db.collection('alerts').countDocuments(), 1);
});

test('Missing samples, delayed historical readings and duplicate timestamps cannot prove recovery', async () => {
  const f = await setup();
  await f.measure(0, 250); await f.measure(5);
  await f.service.evaluate(f.device, { ...f.sample(5), receivedAt: f.sample(15).receivedAt });
  assert.equal(+(await f.alert()).lastSeen, +f.sample(5).receivedAt);
  await f.service.evaluate(f.device, { ...f.sample(6), receivedAt: f.sample(60).receivedAt });
  assert.equal(+(await f.alert()).lastSeen, +f.sample(5).receivedAt);
  await f.measure(60);
  assert.equal(+(await f.alert()).recoverySince, +f.sample(60).receivedAt);
  await f.measure(70);
  await f.service.evaluate(f.device, { ...f.sample(75), dien_ap_v: undefined });
  assert.equal((await f.alert()).recoverySince, null);
  for (const t of [80, 90, 100]) await f.measure(t);
  assert.equal((await f.alert()).tinh_trang, 'Đang phục hồi');
  await f.measure(110);
  assert.equal((await f.alert()).tinh_trang, 'Đã kết thúc');
});

test('Leaving a time window does not resolve a violation; actual recovery is still monitored', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: +new Date('2026-11-05T14:59:30Z') });
  const f = await setup({ khung_gio_ap_dung: '21:00-22:00' });
  for (const t of [0, 10, 20, 30, 40]) await f.measure(t, 250);
  assert.equal((await f.alert()).tinh_trang, 'Đang diễn ra');
  assert.equal((await f.alert()).outsideWindow, true);
  for (const t of [45, 55, 65, 75]) await f.measure(t);
  assert.equal((await f.alert()).tinh_trang, 'Đã kết thúc');
});

test('Voltage is normal only when both high and low bounds are satisfied', async () => {
  const f = await setup();
  await f.db.collection('rules').insertOne({ ...f.rule, _id: 'low', toan_tu: '<', gia_tri_nguong: 200 });
  await f.measure(0, 250);
  for (const t of [5, 15, 25, 35, 45]) await f.measure(t, 180);
  assert.equal((await f.alert()).tinh_trang, 'Đang diễn ra');
  assert.equal(await f.db.collection('alerts').countDocuments(), 2);
  for (const t of [50, 60, 70, 80]) await f.measure(t);
  const rows = await f.db.collection('alerts').find().toArray();
  assert.ok(rows.every((row: any) => row.resolvedBy === 'system'));
});

test('Pausing a rule cannot resolve a fault, and re-enabling restarts recovery observation', async () => {
  const f = await setup();
  await f.measure(0, 250); await f.measure(5);
  await f.service.saveRule({ bat: false }, {} as any, 'r');
  await f.measure(40);
  assert.equal((await f.alert()).monitoringPaused, true);
  assert.equal((await f.alert()).tinh_trang, 'Đang diễn ra');
  await f.service.saveRule({ bat: true, gia_tri_nguong: 280 }, {} as any, 'r');
  await f.measure(45, 250);
  assert.equal((await f.alert()).tinh_trang, 'Đang diễn ra', 'original incident threshold is retained');
  for (const t of [50, 60, 70, 80]) await f.measure(t);
  assert.equal((await f.alert()).tinh_trang, 'Đã kết thúc');
});

test('Reminders retain the incident ID, use latest readings and enforce at least five minutes', async () => {
  const f = await setup({ cooldown: 5 });
  await f.measure(0, 250);
  const initial = await f.alert();
  await f.db.collection('alerts').updateOne({ _id: initial._id }, { $set: {
    trang_thai_gui: 'Thành công', telegramMessageId: 1, initialDeliveryStatus: 'SENT',
  } });
  await f.measure(5, 260);
  assert.equal((await f.alert()).notificationId, initial.notificationId);
  await f.db.collection('alerts').updateOne({ _id: initial._id }, { $set: {
    lastQueuedAt: new Date(Date.now() - 301000),
  } });
  await f.measure(10, 270);
  const reminder = await f.alert();
  assert.equal(reminder._id, initial._id);
  assert.equal(reminder.notificationKind, 'reminder');
  assert.match(reminder.notificationText, /270 V/);
  assert.match(reminder.notificationText, /NHẮC THÔNG SỐ/);
  assert.equal(reminder.cooldown, 300);
});

test('Recovery delivery survives worker restart, retries failures and is not overwritten by an in-flight detection', async () => {
  const f = await setup({ thoi_gian_phuc_hoi: 1 });
  const oldToken = process.env.TELEGRAM_BOT_TOKEN, oldChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = '123:test'; process.env.TELEGRAM_CHAT_ID = '-100123';
  try {
    let finish!: (value: Response) => void;
    const fetch = mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
    await f.measure(0, 250);
    const pending = f.service.notifications();
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    await f.measure(5); await f.measure(6);
    const recoveryId = (await f.alert()).recoveryNotification.notificationId;
    finish(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })));
    await pending;
    assert.equal((await f.alert()).recoveryNotification.notificationId, recoveryId);
    fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ ok: false, error_code: 500 }), { status: 500 }));
    const worker = () => new Alerts(f.db as any, { send() {} } as any, {} as any, {} as any);
    await worker().notifications();
    assert.equal((await f.alert()).recoveryNotification.trang_thai_gui, 'Thất bại');
    assert.equal((await f.alert()).resolvedBy, 'system');
    await f.db.collection('alerts').updateOne({ _id: (await f.alert())._id }, { $set: {
      'recoveryNotification.nextRetry': new Date(0),
    } });
    fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 2 } })));
    await worker().notifications(); await worker().notifications();
    const ended = await f.alert();
    assert.equal(ended.recoveryNotification.trang_thai_gui, 'Thành công');
    assert.equal(ended.recoveryNotification.telegramMessageId, 2);
    assert.equal(fetch.mock.callCount(), 3);
    assert.deepEqual(ended.deliveryLog.map((log: any) => log.kind), ['detected', 'recovered', 'recovered']);
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = oldChat;
  }
});
