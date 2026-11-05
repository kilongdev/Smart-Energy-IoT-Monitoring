export class TelegramError extends Error {
  constructor(message: string, public readonly retryAfter = 0) {
    super(message);
  }
}

export function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || '';
  return { token, chatId, configured: Boolean(token && chatId) };
}

// Never expose fetch errors: they can contain the request URL and bot token.
export async function telegramRequest(method: string, payload: object = {}) {
  const { token } = telegramConfig();
  if (!token) throw new TelegramError('Chưa cấu hình TELEGRAM_BOT_TOKEN.');
  let response: Response;
  let data: any;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    data = await response.json();
  } catch {
    throw new TelegramError('Không kết nối được Telegram hoặc phản hồi không hợp lệ (timeout 5 giây).');
  }
  if (!response.ok || data?.ok !== true) {
    const code = data?.error_code || response.status;
    const hints: Record<number, string> = {
      400: 'Kiểm tra Chat ID, quyền gửi tin và việc đã nhắn /start cho bot.',
      401: 'Bot token không hợp lệ; kiểm tra token từ BotFather.',
      403: 'Bot bị chặn hoặc không có quyền gửi vào cuộc trò chuyện.',
      409: 'Bot đang dùng webhook hoặc có tiến trình khác đọc getUpdates.',
      429: 'Telegram giới hạn tốc độ gửi; hệ thống sẽ chờ rồi thử lại.',
    };
    const migration = data?.parameters?.migrate_to_chat_id;
    const retryAfter = Number(data?.parameters?.retry_after);
    // Only include known fields, not the remote description (which may echo input).
    throw new TelegramError(
      `Telegram ${code}: ${hints[code] || 'Dịch vụ tạm thời không nhận yêu cầu.'}` +
        (Number.isSafeInteger(migration) ? ` Cập nhật TELEGRAM_CHAT_ID=${migration}.` : ''),
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0,
    );
  }
  return data.result;
}

export async function sendTelegram(text: string) {
  const { chatId, configured } = telegramConfig();
  if (!configured) throw new TelegramError('Chưa cấu hình đủ TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID.');
  const result = await telegramRequest('sendMessage', {
    chat_id: chatId,
    text: text.slice(0, 4000),
    link_preview_options: { is_disabled: true },
  });
  if (!Number.isInteger(result?.message_id)) {
    throw new TelegramError('Telegram không trả về mã tin nhắn hợp lệ.');
  }
  return result.message_id as number;
}

export function telegramAlertText(device: any, rule: any, sample: any, location: string, id: string,
  options: { kind?: 'detected' | 'reminder' | 'recovered'; startedAt?: Date; recoverySeconds?: number } = {}) {
  const metrics: Record<string, [string, string]> = {
    cong_suat_w: ['Công suất', 'W'],
    dien_ap_v: ['Điện áp', 'V'],
    dong_dien_a: ['Dòng điện', 'A'],
    nhiet_do_c: ['Nhiệt độ', '°C'],
    dong_ro_ma: ['Dòng rò', 'mA'],
  };
  const [label, unit] = metrics[rule.chi_so_can_do] || [rule.chi_so_can_do, ''];
  const severity: Record<string, string> = { HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp' };
  const time = new Date(sample.thoi_gian_do).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  const short = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 250);
  const kind = options.kind || 'detected';
  const titles = { detected: '🔴 PHÁT HIỆN BẤT THƯỜNG', reminder: '🟠 NHẮC THÔNG SỐ CHƯA PHỤC HỒI', recovered: '🟢 THÔNG SỐ ĐÃ PHỤC HỒI' };
  const started = options.startedAt ? new Date(options.startedAt) : new Date(sample.thoi_gian_do);
  const seconds = Math.max(0, Math.round((+new Date(sample.thoi_gian_do) - +started) / 1000));
  let dashboard = '';
  try {
    const url = new URL(process.env.DASHBOARD_URL || '');
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      url.searchParams.set('alert', id);
      dashboard = `Mở sự cố: ${url.toString()}`;
    }
  } catch { /* Optional dashboard URL. */ }
  return [
    titles[kind],
    `Mức độ: ${severity[rule.muc_do] || rule.muc_do}`,
    `Vị trí: ${short(location)}`,
    `Thiết bị: ${short(device.ten_thiet_bi)}`,
    `Quy tắc: ${short(rule.ten_quy_tac)}`,
    `${label}: ${sample[rule.chi_so_can_do]} ${unit}`,
    `Ngưỡng: ${rule.toan_tu} ${rule.gia_tri_nguong} ${unit}`,
    Number.isFinite(rule.gia_tri_phuc_hoi)
      ? `Vùng phục hồi: ${['>', '>='].includes(rule.toan_tu) ? '<' : '>'} ${rule.gia_tri_phuc_hoi} ${unit}` : '',
    kind === 'recovered'
      ? `Chỉ số đã nằm trong khoảng cho phép liên tục ${options.recoverySeconds || 30} giây.`
      : kind === 'reminder' ? `Sự cố chưa phục hồi; đã theo dõi ${seconds} giây.`
      : `Duy trì vi phạm: ${rule.thoi_gian_duy_tri} giây`,
    `Phát hiện: ${started.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })}`,
    `Thời điểm đo: ${time} (giờ Việt Nam)`,
    `Mã cảnh báo: ${id}`,
    kind === 'recovered' ? 'Cảnh báo thông số tự kết thúc theo dữ liệu đo; không phải xác nhận an toàn điện.'
      : 'Bản tin ghi nhận tại thời điểm đo. Vui lòng kiểm tra thiết bị và xem trạng thái mới nhất trên dashboard.',
    dashboard,
  ].filter(Boolean).join('\n');
}
