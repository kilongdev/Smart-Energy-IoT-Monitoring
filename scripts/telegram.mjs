// Uses the same Telegram client as the alert worker; no token in command arguments.
let client;
try {
  client = await import('../dist/src/telegram.js');
} catch {
  console.error('Chạy npm run build trước khi dùng công cụ Telegram.');
  process.exit(1);
}

const { telegramConfig, telegramRequest, sendTelegram } = client;
const command = process.argv[2] || 'check';
try {
  if (!['check', 'chats', 'test'].includes(command)) {
    throw new Error('Cách dùng: npm run telegram -- check|chats|test');
  }
  const bot = await telegramRequest('getMe');
  console.log(`Bot: @${bot.username}`);
  if (command === 'chats') {
    const webhook = await telegramRequest('getWebhookInfo');
    if (webhook.url) {
      throw new Error('Bot đang dùng webhook. Lấy Chat ID từ ứng dụng xử lý webhook; công cụ không tự xóa webhook.');
    }
    const updates = await telegramRequest('getUpdates', { timeout: 0, limit: 100 });
    const chats = new Map();
    for (const update of updates) {
      const chat = (update.message || update.channel_post || update.my_chat_member)?.chat;
      if (chat) chats.set(String(chat.id), {
        chat_id: String(chat.id), type: chat.type,
        name: chat.title || chat.username || chat.first_name || '',
      });
    }
    if (!chats.size) console.log('Chưa thấy chat. Nhắn /start cho bot, hoặc /start@ten_bot trong nhóm, rồi chạy lại.');
    else console.table([...chats.values()]);
  } else {
    const { configured, chatId } = telegramConfig();
    if (!configured) throw new Error('Điền TELEGRAM_CHAT_ID trong .env; dùng npm run telegram -- chats để tra cứu.');
    const chat = await telegramRequest('getChat', { chat_id: chatId });
    console.log(`Chat nhận: ${chat.title || chat.first_name || chat.username || chat.id} (${chat.type})`);
    if (command === 'test') {
      const id = await sendTelegram('✅ Smart Energy IoT: Tin nhắn kiểm tra kết nối Telegram. Đây là tin thử, không phải sự cố điện.');
      console.log(`Telegram đã nhận tin thử (message_id=${id}).`);
    } else console.log('Bot và Chat ID hợp lệ. Dùng lệnh test để kiểm tra quyền gửi tin.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
