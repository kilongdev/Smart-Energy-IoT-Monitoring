type AlertRecord = Record<string, any>;
export function isAlertOpen(row: AlertRecord) {
  return row.isOpen ?? !['Đã kết thúc', 'Đã gộp'].includes(row.tinh_trang);
}
// /alerts/active is a compact notification projection. It must never replace
// the detailed history row containing delivery and recovery state.
export function mergeAlertRecords(history: AlertRecord[], active: AlertRecord[]) {
  return [...new Map<string, AlertRecord>([...active, ...history].map(row => [row._id, row])).values()];
}
