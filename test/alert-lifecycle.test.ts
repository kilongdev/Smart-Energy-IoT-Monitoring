import 'reflect-metadata';
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Alerts } from '../src/alerts';
import { MemoryStore } from './memory-store';

afterEach(() => mock.restoreAll());
test('Socket events carry persisted readings and recovery without a history refetch', async () => {
  const f=await setup({thoi_gian_phuc_hoi:5});
  await f.measure(0,250);
  const event=()=>f.events.at(-1);
  assert.equal(event()[1],'alert'); assert.equal(event()[3],true);
  assert.equal(event()[2].record.measurementState,'ACTIVE');
  await f.measure(1,260);
  assert.equal(event()[2].record.snapshot.sample.dien_ap_v,260);
  assert.equal(event()[2].notify,false);
  await f.measure(2,220);
  assert.equal(event()[2].record.measurementState,'RECOVERING');
  assert.equal(event()[2].notify,true);
  await f.measure(7,220);
  assert.equal(event()[2].record.measurementState,'RECOVERED');
  assert.equal(event()[2].record.isOpen,false);
  assert.deepEqual(event()[2].record,await f.alert());
});
test('Three repeated incidents recover and reopen without restarting the engine', async () => {
  const f = await setup({ thoi_gian_phuc_hoi: 5 });
  const ids = new Set<string>();
  for (let cycle = 0; cycle < 3; cycle++) {
    const t = cycle * 20;
    await f.measure(t, 250);
    const active = await f.db.collection('alerts').findOne({ isOpen: true });
    assert.equal(active.measurementState, 'ACTIVE'); ids.add(active._id);
    await f.measure(t + 2, 220);
    assert.equal((await f.db.collection('alerts').findOne({_id:active._id})).measurementState, 'RECOVERING');
    await f.measure(t + 3, 250);
    assert.equal((await f.db.collection('alerts').findOne({_id:active._id})).measurementState, 'ACTIVE');
    await f.measure(t + 5, 220); await f.measure(t + 10, 220);
    assert.equal((await f.db.collection('alerts').findOne({_id:active._id})).measurementState, 'RECOVERED');
    assert.equal(await f.db.collection('alerts').countDocuments({isOpen:true}), 0);
  }
  assert.equal(ids.size, 3);
});
test('Detection sample is immutable while latest evaluated sample changes', async () => {
  const f = await setup();
  await f.measure(0, 250); await f.measure(5, 260);
  assert.equal((await f.alert()).snapshot.detectedSample.dien_ap_v, 250);
  assert.equal((await f.alert()).snapshot.sample.dien_ap_v, 260);
});

test('Missing metric resets recovery but does not let older telemetry restart it', async () => {
  const f = await setup();
  await f.measure(0, 250); await f.measure(5, 220);
  await f.service.evaluate(f.device, { ...f.sample(10), dien_ap_v: undefined });
  await f.service.evaluate(f.device, { ...f.sample(6, 220), receivedAt: f.sample(11).receivedAt });
  assert.equal((await f.alert()).measurementState, 'ACTIVE');
  assert.equal((await f.alert()).recoverySince, null);
});

test('A failed alert write can retry the same sample without losing recovery', async () => {
  const f = await setup();
  await f.measure(0, 250);
  const collection = f.db.collection.bind(f.db);
  let fail = true;
  mock.method(f.db, 'collection', (name: string) => {
    const result = collection(name);
    if (name === 'alerts') {
      const update = result.updateOne.bind(result);
      result.updateOne = async (query: any, change: any, options: any) => {
        if (fail && change.$set?.['snapshot.sample']) { fail = false; throw new Error('temporary write failure'); }
        return update(query, change, options);
      };
    }
    return result;
  });
  await assert.rejects(f.measure(5, 220), /temporary write failure/);
  await f.measure(5, 220);
  assert.equal((await f.alert()).measurementState, 'RECOVERING');
});

test('B101: 3145.6 W received 114 seconds late cannot recover a 4000 W incident', async () => {
  const f = await setup({ chi_so_can_do:'cong_suat_w', gia_tri_nguong:4000,
    gia_tri_phuc_hoi:3500, thoi_gian_phuc_hoi:5 });
  await f.service.evaluate(f.device, { ...f.sample(0), cong_suat_w:4942.4 });
  await f.service.evaluate(f.device, { ...f.sample(2), receivedAt:f.sample(116).receivedAt, cong_suat_w:3145.6 });
  assert.equal((await f.alert()).measurementState, 'ACTIVE');
  assert.equal((await f.alert()).snapshot.sample.cong_suat_w, 4942.4);
  await f.service.evaluate(f.device, { ...f.sample(120), cong_suat_w:3145.6 });
  assert.equal((await f.alert()).measurementState, 'RECOVERING');
  await f.service.evaluate(f.device, { ...f.sample(125), cong_suat_w:3145.6 });
  assert.equal((await f.alert()).measurementState, 'RECOVERED');
});

test('Simultaneous devices keep independent pending, active and recovery states', async () => {
  const f = await setup({ thoi_gian_duy_tri:5, thoi_gian_phuc_hoi:5 });
  const other = { ...f.device, _id:'other', ma_phong:'other-room' };
  await f.db.collection('rules').insertOne({ ...f.rule, _id:'other-rule', ma_thiet_bi:'other' });
  await Promise.all([f.measure(0,250),f.service.evaluate(other,f.sample(0,220))]);
  assert.equal(await f.db.collection('alerts').countDocuments(),0);
  await Promise.all([f.measure(5,250),f.service.evaluate(other,f.sample(5,220))]);
  assert.equal(await f.db.collection('alerts').countDocuments(),1);
  await Promise.all([f.measure(10,220),f.service.evaluate(other,f.sample(10,250))]);
  await Promise.all([f.measure(15,220),f.service.evaluate(other,f.sample(15,250))]);
  assert.equal((await f.alert()).measurementState,'RECOVERED');
  const active = await f.db.collection('alerts').findOne({ma_thiet_bi:'other'});
  assert.equal(active.measurementState,'ACTIVE');
  assert.equal(active.ma_phong,'other-room');
});
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
  assert.equal(f.events.filter(event => event[1] === 'alert' && event[2].notify !== false).length, 3,
    'detection, start recovery and return to ACTIVE must each notify clients');
  assert.equal((await f.alert()).recoverySince, null);
  assert.equal((await f.alert()).tinh_trang, 'Đang diễn ra');
  for (const t of [30, 40, 50]) await f.measure(t);
  assert.equal((await f.alert()).tinh_trang, 'Đang phục hồi');
  await f.measure(60);
  assert.equal((await f.alert()).tinh_trang, 'Đã kết thúc');
  assert.equal(await f.db.collection('alerts').countDocuments(), 1);
});

for (const [metric, operator, threshold, recovery, fault, boundary, normal] of [
  ['cong_suat_w', '>', 4000, 3800, 4500, 3900, 3500],
  ['dien_ap_v', '<', 198, 205, 180, 200, 220],
  ['dien_ap_v', '>', 242, 235, 250, 240, 220],
  ['nhiet_do_c', '>=', 60, 55, 65, 58, 40],
  ['dong_ro_ma', '>=', 30, 20, 40, 25, 0],
  ['dong_dien_a', '>', 20, 18, 25, 19, 10],
] as const) {
  test(`${metric} ${operator}: sustain, hysteresis, interrupted recovery and completion`, async () => {
    const f = await setup({ chi_so_can_do: metric, toan_tu: operator,
      gia_tri_nguong: threshold, gia_tri_phuc_hoi: recovery,
      thoi_gian_duy_tri: 5, thoi_gian_phuc_hoi: 10 });
    const send = (seconds: number, value: number) => f.service.evaluate(f.device,
      { ...f.sample(seconds), [metric]: value });
    await send(0, fault);
    assert.equal(await f.alert(), null);
    await send(5, fault);
    const id = (await f.alert())._id;
    await send(10, boundary);
    assert.equal((await f.alert()).measurementState, 'ACTIVE');
    await send(15, normal);
    assert.equal((await f.alert()).measurementState, 'RECOVERING');
    await send(20, fault);
    assert.equal((await f.alert()).recoverySince, null);
    assert.equal((await f.alert())._id, id);
    await send(25, normal); await send(30, normal);
    assert.equal((await f.alert()).isOpen, true);
    await send(35, normal);
    assert.equal((await f.alert()).measurementState, 'RECOVERED');
    assert.equal((await f.alert()).isOpen, false);
    assert.equal((await f.alert()).recoveryNotification.notificationKind, 'recovered');
  });
}

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

test('A newer but delayed sample interrupts recovery instead of leaving a frozen RECOVERING badge', async () => {
  const f = await setup({ thoi_gian_phuc_hoi: 5 });
  await f.measure(0, 250); await f.measure(2, 220);
  assert.equal((await f.alert()).measurementState, 'RECOVERING');
  await f.service.evaluate(f.device, { ...f.sample(4, 260), receivedAt: f.sample(106).receivedAt });
  assert.equal((await f.alert()).measurementState, 'ACTIVE');
  assert.equal((await f.alert()).recoverySince, null);
  assert.ok((await f.alert()).recoveryInterruptedReason);
  assert.equal(+(await f.alert()).lastSeen, +f.sample(2).receivedAt, 'a delayed sample is not a valid evaluation');
  await f.measure(110, 250);
  assert.equal((await f.alert()).recoveryInterruptedReason, null);
  await f.measure(115, 220); await f.measure(120, 220);
  assert.equal((await f.alert()).measurementState, 'RECOVERED');
});

test('Recovery expires without new samples and cannot complete from elapsed wall time alone', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await setup();
  await f.measure(0, 250); await f.measure(5);
  t.mock.timers.tick(36_000);
  await f.service.expireRecoveries();
  assert.equal((await f.alert()).measurementState, 'ACTIVE');
  assert.equal((await f.alert()).isOpen, true);
  assert.equal((await f.alert()).recoverySince, null);
  assert.equal((await f.alert()).recoveryNotification, undefined);
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
