import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri || !uri.startsWith('mongodb+srv://') || uri.includes('<')) {
  console.error('Điền MONGO_URI hoàn chỉnh (mongodb+srv://...) vào .env trước.');
  process.exit(1);
}
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'smart_energy');
  await db.command({ ping: 1 });
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  console.log(`Kết nối Atlas thành công. Database: ${db.databaseName}. Số collection: ${collections.length}.`);
  console.log('Chỉ kiểm tra kết nối; chưa chuyển dữ liệu hoặc đổi backend đang chạy.');
} catch (error) {
  // Avoid printing driver messages or connection strings containing credentials.
  console.error(`Không kết nối được Atlas (${error.name}). Kiểm tra database user, mật khẩu, IP Access List và mạng/DNS.`);
  process.exitCode = 1;
} finally {
  await client.close();
}
