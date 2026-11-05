import { compare } from './domain';

export const MAX_SAMPLE_DELAY_MS = 30_000;
export const MAX_CLOCK_AHEAD_MS = 5_000;
export const DELIVERY_LIFETIME_MS = 15 * 60_000;

export function inRecoveryRange(value: number, rule: any) {
  if (!Number.isFinite(value)) return false;
  if (!Number.isFinite(rule.gia_tri_phuc_hoi)) {
    return !compare(value, rule.toan_tu, rule.gia_tri_nguong);
  }
  if (['>', '>='].includes(rule.toan_tu)) return value < rule.gia_tri_phuc_hoi;
  if (['<', '<='].includes(rule.toan_tu)) return value > rule.gia_tri_phuc_hoi;
  return !compare(value, rule.toan_tu, rule.gia_tri_nguong);
}

export function validRecoveryThreshold(rule: any) {
  if (rule.gia_tri_phuc_hoi == null) return true;
  return Number.isFinite(rule.gia_tri_phuc_hoi) && (
    (['>', '>='].includes(rule.toan_tu) && rule.gia_tri_phuc_hoi < rule.gia_tri_nguong) ||
    (['<', '<='].includes(rule.toan_tu) && rule.gia_tri_phuc_hoi > rule.gia_tri_nguong)
  );
}

// The partial index is installed before migration so simultaneous application
// starts cannot create two open incidents. Duplicate history is retained.
export async function prepareAlertStorage(db: { collection(name: string): any }) {
  const alerts = db.collection('alerts');
  await alerts.createIndex({ ma_thiet_bi: 1, ma_quy_tac: 1 }, {
    name: 'one_open_incident_per_device_rule', unique: true,
    partialFilterExpression: { isOpen: true },
  });
  const legacy = await alerts.find({ lifecycleVersion: { $ne: 2 } })
    .sort({ thoi_gian_phat_hien: 1, _id: 1 }).toArray();
  for (const row of legacy) {
    const isOpen = !['Đã kết thúc', 'Đã gộp'].includes(row.tinh_trang);
    const sent = row.lastNotifiedAt || row.telegramMessageId || row.trang_thai_gui === 'Thành công';
    const initialDeliveryStatus = sent ? 'SENT'
      : !row.notificationText || row.attempts >= 3 ? 'FAILED' : 'PENDING';
    const patch: any = {
      lifecycleVersion: 2, isOpen,
      measurementState: isOpen ? (row.tinh_trang === 'Đang phục hồi' ? 'RECOVERING' : 'ACTIVE') : 'RECOVERED',
      trang_thai: isOpen ? 'Đang theo dõi' : 'Đã phục hồi',
      initialDeliveryStatus,
      notificationKind: row.notificationKind || 'detected',
      deliveryDeadline: row.deliveryDeadline || new Date(+(row.lastQueuedAt || row.thoi_gian_phat_hien || new Date()) + DELIVERY_LIFETIME_MS),
    };
    // Old resolved history must not suddenly send a delayed detection on upgrade.
    if (!isOpen && !row.recoveryNotification && !sent) {
      patch.trang_thai_gui = 'Thất bại vĩnh viễn';
      patch.initialDeliveryStatus = 'FAILED';
    }
    if (row.recoveryNotification && !row.recoveryNotification.deliveryDeadline) {
      patch['recoveryNotification.deliveryDeadline'] = new Date(+(row.ket_thuc_luc || new Date()) + DELIVERY_LIFETIME_MS);
    }
    try {
      await alerts.updateOne({ _id: row._id, lifecycleVersion: { $ne: 2 } }, { $set: patch });
    } catch (error: any) {
      if (error.code !== 11000) throw error;
      const canonical = await alerts.findOne({ ma_thiet_bi: row.ma_thiet_bi, ma_quy_tac: row.ma_quy_tac, isOpen: true });
      if (!canonical) throw error;
      await alerts.updateOne({ _id: row._id, lifecycleVersion: { $ne: 2 } }, { $set: {
        lifecycleVersion: 2, isOpen: false, measurementState: 'SUPERSEDED',
        tinh_trang: 'Đã gộp', trang_thai: 'Đã gộp', supersededBy: canonical._id,
        trang_thai_gui: 'Đã hủy', initialDeliveryStatus: 'FAILED',
      } });
    }
  }
}
