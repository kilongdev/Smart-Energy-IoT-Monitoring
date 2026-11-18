import { isAlertOpen } from './alert-records';
type Row = Record<string, any>;

export function upsertLiveAlert(rows: Row[], record: Row, activeOnly = false) {
  const next = [record, ...rows.filter(row => row._id !== record._id)];
  return next.filter(row => !activeOnly || isAlertOpen(row))
    .sort((a, b) => +new Date(b.thoi_gian_phat_hien) - +new Date(a.thoi_gian_phat_hien));
}

// Alert HTTP reads are serialized by createAlertRefresh. Remember socket changes
// received during that read, including closed incidents removed from the bell.
export function createAlertLiveOverlay() {
  const duringRead = new Map<string, Row>();
  return {
    beginRead() { duringRead.clear(); },
    accept(record: Row) { duringRead.set(record._id, record); },
    reconcile(rows: Row[], activeOnly = false) {
      let result = rows;
      for (const record of duringRead.values()) result = upsertLiveAlert(result, record, activeOnly);
      return result;
    },
  };
}
