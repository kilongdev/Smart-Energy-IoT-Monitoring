import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';

// Nạp thêm tài khoản + lịch hẹn giờ cho toàn bộ 17 phòng.
// Idempotent: chạy lại nhiều lần không tạo trùng (dựa theo tai_khoan và ma_thiet_bi+gio).
// Mật khẩu: QuanLy/NguoiXem dùng DEMO_PASSWORD, Admin dùng ADMIN_PASSWORD trong .env.

if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env');
if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 10)
  throw new Error('DEMO_PASSWORD phải >= 10 ký tự');
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 10)
  throw new Error('ADMIN_PASSWORD phải >= 10 ký tự');

const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'smart_energy');
  const now = new Date();

  const buildings = await db.collection('buildings').find({}).toArray();
  const byName = new Map(buildings.map((b) => [b.ten_toa_nha, b._id]));
  for (const name of ['Tòa nhà A', 'Tòa nhà B', 'Tòa nhà C', 'Tòa nhà D']) {
    if (!byName.has(name)) throw new Error('Thiếu ' + name + ' trong Atlas');
  }
  const allIds = ['Tòa nhà A', 'Tòa nhà B', 'Tòa nhà C', 'Tòa nhà D'].map((n) => byName.get(n));

  const desiredUsers = [
    // Quản lý còn thiếu cho tòa C, D
    { tai_khoan: 'manager_c', ho_ten: 'Quản lý tòa C', vai_tro: 'QuanLy', buildingIds: [byName.get('Tòa nhà C')], pass: process.env.DEMO_PASSWORD },
    { tai_khoan: 'manager_d', ho_ten: 'Quản lý tòa D', vai_tro: 'QuanLy', buildingIds: [byName.get('Tòa nhà D')], pass: process.env.ADMIN_PASSWORD && process.env.DEMO_PASSWORD ? process.env.DEMO_PASSWORD : process.env.DEMO_PASSWORD },
    // Người xem: 1 cho C, 1 cho D, 1 xem toàn campus
    { tai_khoan: 'viewer_c', ho_ten: 'Người xem tòa C', vai_tro: 'NguoiXem', buildingIds: [byName.get('Tòa nhà C')], pass: process.env.DEMO_PASSWORD },
    { tai_khoan: 'viewer_d', ho_ten: 'Người xem tòa D', vai_tro: 'NguoiXem', buildingIds: [byName.get('Tòa nhà D')], pass: process.env.DEMO_PASSWORD },
    { tai_khoan: 'viewer_all', ho_ten: 'Người xem toàn campus', vai_tro: 'NguoiXem', buildingIds: allIds, pass: process.env.DEMO_PASSWORD },
    // Thêm 2 admin
    { tai_khoan: 'admin2', ho_ten: 'Quản trị viên 2', vai_tro: 'Admin', buildingIds: [], pass: process.env.ADMIN_PASSWORD },
    { tai_khoan: 'admin_kythuat', ho_ten: 'Quản trị kỹ thuật', vai_tro: 'Admin', buildingIds: [], pass: process.env.ADMIN_PASSWORD },
  ];

  let createdUsers = 0;
  for (const u of desiredUsers) {
    const existed = await db.collection('users').findOne({ tai_khoan: u.tai_khoan });
    if (existed) {
      console.log(`- Giữ nguyên: ${u.tai_khoan} (${u.vai_tro})`);
      continue;
    }
    await db.collection('users').insertOne({
      _id: randomUUID(),
      tai_khoan: u.tai_khoan,
      ho_ten: u.ho_ten,
      mat_khau: await hash(u.pass, 12),
      vai_tro: u.vai_tro,
      buildingIds: u.buildingIds,
      active: true,
      tokenVersion: 0,
      createdAt: now,
    });
    createdUsers++;
    console.log(`+ Đã tạo: ${u.tai_khoan} (${u.ho_ten}, ${u.vai_tro})`);
  }

  // Lịch hẹn giờ cho TẤT CẢ phòng: sáng Bật 06:30, tối Tắt 22:00, T2-T6.
  const devices = await db.collection('devices').find({}).toArray();
  const plans = [
    { hanh_dong: 'Bật', gio_bat_dau: '06:30:00', ngay_lap_lai: 'T2,T3,T4,T5,T6' },
    { hanh_dong: 'Tắt', gio_bat_dau: '22:00:00', ngay_lap_lai: 'T2,T3,T4,T5,T6' },
  ];
  let createdSchedules = 0;
  for (const device of devices) {
    if (!device.cho_phep_dieu_khien) {
      console.log(`- Bỏ qua lịch (không cho điều khiển): ${device.ten_thiet_bi}`);
      continue;
    }
    for (const plan of plans) {
      const days = plan.ngay_lap_lai.split(',');
      const existed = await db.collection('schedules').findOne({
        ma_thiet_bi: device._id,
        gio_bat_dau: plan.gio_bat_dau,
        bat: true,
      });
      if (existed) continue;
      await db.collection('schedules').insertOne({
        _id: randomUUID(),
        ma_thiet_bi: device._id,
        buildingId: device.buildingId,
        hanh_dong: plan.hanh_dong,
        gio_bat_dau: plan.gio_bat_dau,
        ngay_lap_lai: plan.ngay_lap_lai,
        days,
        bat: true,
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: now,
        updatedAt: now,
      });
      createdSchedules++;
    }
  }

  const totalUsers = await db.collection('users').countDocuments();
  const totalSchedules = await db.collection('schedules').countDocuments();
  console.log(`\nXong: +${createdUsers} tài khoản, +${createdSchedules} lịch. Tổng: ${totalUsers} users, ${totalSchedules} schedules.`);
  console.log('Mật khẩu: QuanLy/NguoiXem = DEMO_PASSWORD, Admin mới = ADMIN_PASSWORD trong .env.');
} catch (error) {
  console.error('Seed thất bại: ' + error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
