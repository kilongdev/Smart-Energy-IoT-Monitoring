import { ConflictException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Catalog } from './catalog';
import { Database } from './database';
import { compare, defined, inWindow, User } from './domain';
import { Events } from './events';
import { Security } from './security';
import { sendTelegram, telegramAlertText, telegramConfig, TelegramError } from './telegram';
import { DELIVERY_LIFETIME_MS, inRecoveryRange, MAX_CLOCK_AHEAD_MS, MAX_SAMPLE_DELAY_MS, validRecoveryThreshold } from './alert-policy';

@Injectable()
export class Alerts implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private sending = false;
  private nextTelegramSend = 0;
  private readonly log = new Logger(Alerts.name);
  constructor(
    private readonly db: Database, private readonly events: Events,
    private readonly catalog: Catalog, private readonly security: Security,
  ) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.notifications().catch(error => this.log.error(error.message));
    }, 1000);
  }
  onModuleDestroy() { clearInterval(this.timer); }
  async rules(user: User) {
    return this.db.collection('rules').find(this.security.buildingFilter(user)).sort({ createdAt: -1 }).toArray();
  }
  async saveRule(dto: any, user: User, id?: string) {
    dto = defined(dto);
    const oldRule = id ? await this.db.collection('rules').findOne({ _id: id }) : null;
    if (id && !oldRule) throw new ConflictException('Quy tắc không tồn tại');
    if (oldRule) this.security.checkBuilding(user, oldRule.buildingId);
    const data = { thoi_gian_duy_tri: 10, thoi_gian_phuc_hoi: 30, cooldown: 300,
      muc_do: 'HIGH', bat: true, ...oldRule, ...dto };
    if (!validRecoveryThreshold(data)) throw new ConflictException(
      'Ngưỡng phục hồi phải thấp hơn ngưỡng cảnh báo cao hoặc cao hơn ngưỡng cảnh báo thấp; quy tắc = không hỗ trợ ngưỡng phục hồi riêng.',
    );
    const device = await this.catalog.get('devices', data.ma_thiet_bi, user);
    if (oldRule && (data.ma_thiet_bi !== oldRule.ma_thiet_bi || data.chi_so_can_do !== oldRule.chi_so_can_do)) {
      const active = await this.db.collection('alerts').findOne({ ma_quy_tac: id, isOpen: true });
      if (active) throw new ConflictException('Sự cố còn đang theo dõi; hãy tạo quy tắc mới cho thiết bị hoặc chỉ số khác.');
    }
    const item = { ...data, _id: id || randomUUID(), buildingId: device.buildingId,
      ma_phong: device.ma_phong, start: null, lastSample: null, lastMeasured: null,
      updatedAt: new Date(), createdAt: oldRule?.createdAt || new Date() };
    await this.db.collection('rules').replaceOne({ _id: item._id }, item, { upsert: true });
    await this.db.collection('alerts').updateMany(
      { ma_quy_tac: item._id, isOpen: true },
      { $set: { monitoringPaused: !item.bat, recoverySince: null,
        recoveryStartedAt: null, measurementState: 'ACTIVE', tinh_trang: 'Đang diễn ra', trang_thai: 'Đang theo dõi' } },
    );
    return { ...item, ma_quy_tac: item._id };
  }
  private async location(device: any) {
    const [room, building] = await Promise.all([
      this.db.collection('rooms').findOne({ _id: device.ma_phong }),
      this.db.collection('buildings').findOne({ _id: device.buildingId }),
    ]);
    const floor = room?.ma_tang ? await this.db.collection('floors').findOne({ _id: room.ma_tang }) : null;
    return [building?.ten_toa_nha || device.buildingId,
      floor ? 'Tầng ' + floor.so_tang : null, room?.ten_phong || device.ma_phong].filter(Boolean).join(' / ');
  }
  async evaluate(device: any, sample: any) {
    // Persist the per-device mutex so separate API workers serialize evaluation.
    const locks = this.db.collection('alert_evaluation_locks');
    try {
      await locks.updateOne({ _id: device._id }, { $setOnInsert: { until: new Date(0) } }, { upsert: true });
    } catch (error: any) { if (error.code !== 11000) throw error; }
    const owner = randomUUID();
    const deadline = Date.now() + 5000;
    let acquired = false;
    do {
      acquired = Boolean(await locks.findOneAndUpdate({ _id: device._id, until: { $lte: new Date() } },
        { $set: { owner, until: new Date(Date.now() + 60_000) } }, { returnDocument: 'after' }));
      if (!acquired) await new Promise(resolve => setTimeout(resolve, 25));
    } while (!acquired && Date.now() < deadline);
    if (!acquired) throw new ConflictException('Thiết bị đang được đánh giá; mẫu đo sẽ được thử lại.');
    let lost = false;
    const heartbeat = setInterval(() => {
      locks.updateOne({ _id: device._id, owner }, { $set: { until: new Date(Date.now() + 60_000) } })
        .then(result => { if (!result.matchedCount) lost = true; }).catch(() => { lost = true; });
    }, 10_000);
    try { await this.evaluateLocked(device, sample, () => {
      if (lost) throw new ConflictException('Mất quyền đánh giá thiết bị; thử lại mẫu đo.');
    }); } finally {
      clearInterval(heartbeat);
      await locks.updateOne({ _id: device._id, owner }, { $set: { until: new Date(0) } });
    }
  }

  private async evaluateLocked(device: any, sample: any, checkLease: () => void) {
    const rules = await this.db.collection('rules').find({ ma_thiet_bi: device._id, bat: true }).toArray();
    const received = new Date(sample.receivedAt || sample.thoi_gian_do);
    const measured = new Date(sample.thoi_gian_do);
    const maxGap = device.chu_ky_gui * 5000;
    // Backfilled telemetry is not evidence of current recovery. A sample
    // measured long before it was received is a replay, not a live reading,
    // so it must not advance the incident state either.
    if (!Number.isFinite(+measured) || !Number.isFinite(+received) ||
      +measured - +received > MAX_CLOCK_AHEAD_MS ||
      +received - +measured > MAX_SAMPLE_DELAY_MS ||
      Date.now() - +received > MAX_SAMPLE_DELAY_MS) return;
    for (const rule of rules) {
      checkLease();
      if ((rule.lastSample && +received <= +rule.lastSample) ||
        (rule.lastMeasured && +measured <= +rule.lastMeasured)) continue;
      const alerts = this.db.collection('alerts');
      let alert = await alerts.findOne({ ma_quy_tac: rule._id, ma_thiet_bi: device._id, isOpen: true },
        { sort: { thoi_gian_phat_hien: -1 } });
      const effective = alert ? { ...rule, ...alert.snapshot?.rule } : rule;
      const value = sample[effective.chi_so_can_do];
      if (!Number.isFinite(value)) {
        await this.db.collection('rules').updateOne({ _id: rule._id }, { $set: { start: null, lastSample: null, lastMeasured: null } });
        if (alert) await alerts.updateOne({ _id: alert._id }, { $set: {
          recoverySince: null, recoveryStartedAt: null, measurementState: 'ACTIVE', tinh_trang: 'Đang diễn ra', trang_thai: 'Đang theo dõi',
        } });
        continue;
      }
      const continuous = Boolean(rule.lastSample && rule.lastMeasured &&
        +received - +rule.lastSample <= maxGap && +measured - +rule.lastMeasured <= maxGap);
      const withinWindow = inWindow(measured, rule.khung_gio_ap_dung);
      const violation = compare(value, effective.toan_tu, effective.gia_tri_nguong);
      // Crossing from high voltage to low voltage must not count as normal.
      const bounds = [...(alert?.snapshot?.recoveryConditions || []),
        ...rules.filter(r => r.chi_so_can_do === effective.chi_so_can_do)];
      const normal = inRecoveryRange(value, effective) && bounds.every(r => inRecoveryRange(value, r));
      const start = withinWindow && violation ? (continuous && rule.start ? rule.start : received) : null;
      const updated = await this.db.collection('rules').updateOne(
        { _id: rule._id, updatedAt: rule.updatedAt },
        { $set: { start, lastSample: received, lastMeasured: measured,
          lastValidSampleAt: measured, measurementState: alert ? (normal ? 'RECOVERING' : 'ACTIVE') : start ? 'PENDING' : 'NORMAL' } },
      );
      if (!updated.matchedCount) continue;
      if (alert) {
        const recoverySeconds = Math.max(1, Number(effective.thoi_gian_phuc_hoi) || 30);
        const recoverySince = normal ? (continuous && alert.recoverySince ? alert.recoverySince : received) : null;
        if (recoverySince && +received - +recoverySince >= recoverySeconds * 1000) {
          const location = alert.location || await this.location(device);
          const recoveryNotification = {
            notificationId: randomUUID(), notificationKind: 'recovered',
            notificationText: telegramAlertText(device, effective, sample, location, alert._id, {
              kind: 'recovered', startedAt: alert.thoi_gian_phat_hien, recoverySeconds,
            }),
            trang_thai_gui: 'Đang chờ', attempts: 0, nextRetry: new Date(),
            deliveryDeadline: new Date(Date.now() + DELIVERY_LIFETIME_MS),
          };
          const closed = await alerts.updateOne(
            { _id: alert._id, isOpen: true },
            { $set: {
              isOpen: false, measurementState: 'RECOVERED',
              tinh_trang: 'Đã kết thúc', trang_thai: 'Đã phục hồi', resolvedBy: 'system',
              ket_thuc_luc: received, recoverySince, recoveryStartedAt: recoverySince, recoveryNotification,
              measuredAt: measured, receivedAt: received, lastValidSampleAt: measured,
              lastSeen: received, 'snapshot.sample': sample, monitoringPaused: false,
            } },
          );
          if (closed.modifiedCount) this.events.send(device.buildingId, 'alert', {
            id: alert._id, message: device.ten_thiet_bi + ': Thông số đã phục hồi theo quy tắc giám sát',
          }, true);
          await this.db.collection('rules').updateOne({ _id: rule._id, lastMeasured: measured }, { $set: { measurementState: 'NORMAL' } });
          continue;
        }
        await alerts.updateOne({ _id: alert._id }, { $set: {
          tinh_trang: normal ? 'Đang phục hồi' : 'Đang diễn ra', trang_thai: 'Đang theo dõi',
          recoverySince, recoveryStartedAt: recoverySince, recoverySeconds, lastSeen: received, 'snapshot.sample': sample,
          measurementState: normal ? 'RECOVERING' : 'ACTIVE',
          measuredAt: measured, receivedAt: received, lastValidSampleAt: measured,
          monitoringPaused: false, outsideWindow: !withinWindow,
        }, ...(!normal ? { $inc: { occurrences: 1 } } : {}) });
        if (normal || !withinWindow) {
          if (normal && !alert.recoverySince) this.events.send(device.buildingId, 'alert', { id: alert._id }, true);
          continue;
        }
      } else {
        if (!start || +received - +start < rule.thoi_gian_duy_tri * 1000) continue;
        alert = {
          _id: randomUUID(), ma_quy_tac: rule._id, ma_thiet_bi: device._id,
          isOpen: true, lifecycleVersion: 2, measurementState: 'ACTIVE',
          measuredAt: measured, receivedAt: received, lastValidSampleAt: measured,
          buildingId: device.buildingId, ma_phong: device.ma_phong,
          thoi_gian_phat_hien: received, trang_thai: 'Đang theo dõi', tinh_trang: 'Đang diễn ra', muc_do: rule.muc_do,
          noi_dung_loi: device.ten_thiet_bi + ': ' + rule.chi_so_can_do + ' = ' + value + ' (' + rule.toan_tu + ' ' + rule.gia_tri_nguong + ')',
          snapshot: { rule: {
            ten_quy_tac: rule.ten_quy_tac, chi_so_can_do: rule.chi_so_can_do,
            toan_tu: rule.toan_tu, gia_tri_nguong: rule.gia_tri_nguong,
            gia_tri_phuc_hoi: rule.gia_tri_phuc_hoi ?? null,
            thoi_gian_duy_tri: rule.thoi_gian_duy_tri, thoi_gian_phuc_hoi: rule.thoi_gian_phuc_hoi ?? 30, muc_do: rule.muc_do,
          }, recoveryConditions: bounds.map(r => ({ toan_tu: r.toan_tu, gia_tri_nguong: r.gia_tri_nguong, gia_tri_phuc_hoi: r.gia_tri_phuc_hoi ?? null })), sample },
          occurrences: 1, lastSeen: received, cooldown: Math.max(rule.cooldown || 300, 300),
          location: await this.location(device),
        };
        // Persist the initial event with the incident, avoiding a crash gap.
        Object.assign(alert, {
          initialDeliveryStatus: 'PENDING', notificationKind: 'detected', notificationId: randomUUID(),
          notificationText: telegramAlertText(device, rule, sample, alert.location, alert._id, { kind: 'detected', startedAt: received }),
          trang_thai_gui: 'Đang chờ', attempts: 0, nextRetry: new Date(), lastQueuedAt: new Date(),
          deliveryDeadline: new Date(Date.now() + DELIVERY_LIFETIME_MS),
        });
        try { await alerts.insertOne(alert); }
        catch (error: any) { if (error.code === 11000) continue; throw error; }
        await this.db.collection('rules').updateOne({ _id: rule._id, lastMeasured: measured }, { $set: { measurementState: 'ACTIVE' } });
        this.events.send(device.buildingId, 'alert', { id: alert._id, message: alert.noi_dung_loi }, true);
      }
      const now = new Date();
      const cooldown = Math.max(Number(rule.cooldown) || 300, 300);
      const kind = 'reminder';
      const location = alert.location || await this.location(device);
      await alerts.updateOne({
        _id: alert._id, tinh_trang: 'Đang diễn ra',
        initialDeliveryStatus: { $in: ['SENT', 'FAILED'] },
        $and: [
          { $or: [{ lastQueuedAt: { $exists: false } }, { lastQueuedAt: { $lte: new Date(+now - cooldown * 1000) } }] },
          { $or: [{ trang_thai_gui: { $exists: false } }, { trang_thai_gui: 'Thành công' },
            { trang_thai_gui: 'Thất bại vĩnh viễn', nextRetry: { $lte: now } }] },
        ],
      }, { $set: {
        trang_thai_gui: 'Đang chờ', notificationId: randomUUID(), notificationKind: kind,
        notificationText: telegramAlertText(device, effective, sample, location, alert._id, {
          kind, startedAt: alert.thoi_gian_phat_hien,
        }),
        nextRetry: now, attempts: 0, lastQueuedAt: now, cooldown, location,
        deliveryDeadline: new Date(+now + DELIVERY_LIFETIME_MS),
      } });
    }
  }
  async active(user: User) {
    return this.db.collection('alerts').find({
      ...this.security.buildingFilter(user), isOpen: true,
    }, { projection: {
      _id: 1, ma_thiet_bi: 1, ma_phong: 1, buildingId: 1,
      tinh_trang: 1, muc_do: 1, noi_dung_loi: 1,
      thoi_gian_phat_hien: 1, 'snapshot.rule.ten_quy_tac': 1,
    } }).sort({ thoi_gian_phat_hien: -1 }).toArray();
  }

  async history(user: User, filter: any) {
    const query: any = { ...this.security.buildingFilter(user) };
    if (filter.id) query._id = String(filter.id);
    for (const key of ['ma_phong', 'muc_do', 'trang_thai']) {
      if (filter[key]) query[key] = String(filter[key]);
    }
    if (filter.from || filter.to) {
      query.thoi_gian_phat_hien = {};
      for (const [key, operator] of [['from', '$gte'], ['to', '$lt']]) {
        if (!filter[key]) continue;
        const date = new Date(filter[key]);
        if (!Number.isFinite(+date)) throw new ConflictException('Thời gian không hợp lệ');
        query.thoi_gian_phat_hien[operator] = date;
      }
    }
    return this.db.collection('alerts').find(query).sort({ thoi_gian_phat_hien: -1 }).limit(500).toArray();
  }
  // Separate delivery slots make recovery atomic with incident closure, without
  // overwriting an in-flight detection/reminder request.
  async notifications() {
    if (this.sending) return;
    this.sending = true;
    try {
      const collection = this.db.collection('alerts');
      const configured = telegramConfig().configured;
      for (const prefix of ['', 'recoveryNotification.']) {
        const expired = await collection.find({
          [prefix + 'trang_thai_gui']: { $in: ['Đang chờ', 'Thất bại', 'Chưa cấu hình'] },
          $and: [
            { $or: [{ [prefix + 'deliveryDeadline']: { $lte: new Date() } }, { [prefix + 'attempts']: { $gte: 3 } }] },
            { $or: [{ notificationSendingUntil: { $exists: false } }, { notificationSendingUntil: { $lte: new Date() } }] },
          ],
        }).limit(100).toArray();
        for (const alert of expired) {
          const delivery = prefix ? alert.recoveryNotification : alert;
          await collection.updateOne({
            _id: alert._id, [prefix + 'notificationId']: delivery.notificationId ?? null,
            [prefix + 'trang_thai_gui']: delivery.trang_thai_gui,
            $or: [{ notificationSendingUntil: { $exists: false } }, { notificationSendingUntil: { $lte: new Date() } }],
          }, { $set: {
            [prefix + 'trang_thai_gui']: 'Thất bại vĩnh viễn',
            [prefix + 'lastDeliveryError']: 'Hết thời hạn 15 phút hoặc đã hết ba lượt thử gửi.',
            ...(!prefix && delivery.notificationKind === 'detected' ? { initialDeliveryStatus: 'FAILED' } : {}),
          } });
        }
      }
      if (Date.now() < this.nextTelegramSend) return;
      for (const prefix of ['', 'recoveryNotification.']) {
        const eligibility: any = prefix ? {
          tinh_trang: 'Đã kết thúc', initialDeliveryStatus: { $in: ['SENT', 'FAILED'] },
        } : { $or: [
          { notificationKind: 'detected', initialDeliveryStatus: 'PENDING' },
          { notificationKind: 'reminder', isOpen: true, tinh_trang: 'Đang diễn ra',
            monitoringPaused: { $ne: true }, outsideWindow: { $ne: true } },
        ] };
        const query = {
          ...eligibility,
          [prefix + 'trang_thai_gui']: { $in: configured ? ['Đang chờ', 'Thất bại', 'Chưa cấu hình'] : ['Đang chờ', 'Thất bại'] },
          [prefix + 'nextRetry']: { $lte: new Date() }, [prefix + 'attempts']: { $lt: 3 },
        };
        const pending = await collection.find(query).sort({ [prefix + 'nextRetry']: 1 }).limit(10).toArray();
        for (const alert of pending) {
          const delivery = prefix ? alert.recoveryNotification : alert;
          const identity = { _id: alert._id, [prefix + 'notificationId']: delivery.notificationId ?? null };
          if (!configured) {
            await collection.updateOne(identity, { $set: { [prefix + 'trang_thai_gui']: 'Chưa cấu hình' } });
            continue;
          }
          const lease = randomUUID();
          const claimed = await collection.findOneAndUpdate({
            ...query, ...identity,
            $and: [
              { $or: [{ notificationSendingUntil: { $exists: false } }, { notificationSendingUntil: { $lte: new Date() } }] },
              { $or: [{ [prefix + 'sendingUntil']: { $exists: false } }, { [prefix + 'sendingUntil']: { $lte: new Date() } }] },
            ],
          }, { $set: { notificationOwner: lease, notificationSendingUntil: new Date(Date.now() + 15000),
            [prefix + 'deliveryLease']: lease, [prefix + 'sendingUntil']: new Date(Date.now() + 15000) } },
          { returnDocument: 'after' });
          if (!claimed) continue;
          let state = 'Thành công', error = '', retryAfter = 0;
          let messageId: number | null = null;
          let notificationText = delivery.notificationText || alert.noi_dung_loi;
          if (claimed.initialDeliveryStatus === 'FAILED') {
            notificationText += '\nLưu ý: Thông báo phát hiện ban đầu không gửi thành công; thời điểm phát hiện được ghi ở trên.';
          }
          try { messageId = await sendTelegram(notificationText); }
          catch (cause) {
            state = 'Thất bại';
            error = cause instanceof TelegramError ? cause.message : 'Lỗi gửi Telegram';
            retryAfter = cause instanceof TelegramError ? cause.retryAfter : 0;
          }
          const now = new Date();
          const terminal = state === 'Thất bại' && ((delivery.attempts || 0) + 1 >= 3 ||
            (delivery.deliveryDeadline && +now >= +delivery.deliveryDeadline));
          if (terminal) state = 'Thất bại vĩnh viễn';
          const retryDelay = Math.max(30 * 2 ** (delivery.attempts || 0), retryAfter) * 1000;
          this.nextTelegramSend = +now + Math.max(3100, retryAfter * 1000);
          await collection.updateOne({ ...identity, notificationOwner: lease, [prefix + 'deliveryLease']: lease }, {
            $set: {
              [prefix + 'trang_thai_gui']: state, [prefix + 'nextRetry']: new Date(+now + retryDelay),
              [prefix + 'sendingUntil']: now, [prefix + 'lastDeliveryError']: error,
              [prefix + 'telegramMessageId']: messageId,
              notificationSendingUntil: now,
              ...(!prefix && messageId !== null ? { lastNotifiedAt: now } : {}),
              ...(!prefix && delivery.notificationKind === 'detected' && (messageId !== null || terminal)
                ? { initialDeliveryStatus: messageId !== null ? 'SENT' : 'FAILED' } : {}),
            },
            $inc: { [prefix + 'attempts']: 1 },
            $push: { deliveryLog: { at: now, state, error, messageId, kind: delivery.notificationKind || 'detected' } },
          } as any);
          this.events.send(alert.buildingId, 'alert', { id: alert._id }, true);
          return;
        }
      }
    } finally { this.sending = false; }
  }
}
