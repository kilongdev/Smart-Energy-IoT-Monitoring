import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { hash, compare } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { IDS } from './domain';

@Injectable()
export class Seed implements OnApplicationBootstrap {
  constructor(private db: Database) {}

  async onApplicationBootstrap() {
    const users = this.db.collection('users');
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword || adminPassword.length < 10) {
      throw new Error('ADMIN_PASSWORD phải có ít nhất 10 ký tự');
    }

    const existingAdmin = await users.findOne({
      tai_khoan: adminUsername,
    });

    if (!existingAdmin) {
      await users.insertOne({
        _id: randomUUID(),
        tai_khoan: adminUsername,
        ho_ten: 'Quản trị viên',
        mat_khau: await hash(adminPassword, 12),
        vai_tro: 'Admin',
        buildingIds: [],
        active: true,
        tokenVersion: 0,
        createdAt: new Date(),
      });

      console.log('[Seed] Đã tạo tài khoản admin từ ENV.');
    } else {
      if (existingAdmin.vai_tro !== 'Admin') {
        throw new Error(
          'ADMIN_USERNAME trùng với tài khoản không phải Admin',
        );
      }

      const passwordMatches =
        typeof existingAdmin.mat_khau === 'string' &&
        await compare(adminPassword, existingAdmin.mat_khau);

      if (!passwordMatches) {
        await users.updateOne(
          { _id: existingAdmin._id },
          {
            $set: {
              mat_khau: await hash(adminPassword, 12),
              updatedAt: new Date(),
            },
            $inc: { tokenVersion: 1 },
          },
        );

        console.log('[Seed] Đã cập nhật mật khẩu admin theo ENV.');
      }
    }

    if (process.env.SEED_DEMO !== 'true') {
      return;
    }

    const now = new Date();

    const rows: [string, any][] = [
      [
        'buildings',
        {
          _id: IDS.building,
          ten_toa_nha: 'Tòa nhà A',
          dia_chi: 'Khu học tập Smart Energy',
        },
      ],
      [
        'floors',
        {
          _id: IDS.floor,
          ma_toa_nha: IDS.building,
          buildingId: IDS.building,
          so_tang: 1,
        },
      ],
    ];

    for (let i = 0; i < 3; i++) {
      const room = IDS.room.slice(0, -1) + (3 + i);
      const device = IDS.device.slice(0, -1) + (4 + i);

      rows.push(
        [
          'rooms',
          {
            _id: room,
            ma_tang: IDS.floor,
            buildingId: IDS.building,
            ten_phong: `Phòng A10${i + 1}`,
            loai_phong: 'CLASSROOM',
          },
        ],
        [
          'devices',
          {
            _id: device,
            ma_phong: room,
            buildingId: IDS.building,
            ten_thiet_bi: `Thiết bị A10${i + 1}`,
            dia_chi_mac: `AA:BB:CC:DD:EE:0${i + 1}`,
            chu_de_mqtt: `campus/demo/device${i + 1}`,
            cho_phep_dieu_khien: true,
            cong_suat_dinh_muc: 2000,
            chu_ky_gui: 5,
          },
        ],
      );
    }

    for (const [collection, row] of rows) {
      await this.db.collection(collection).updateOne(
        { _id: row._id },
        {
          $setOnInsert: {
            ...row,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }

    const demoAccounts = [
      ['manager', 'QuanLy'],
      ['viewer', 'NguoiXem'],
    ] as const;

    for (const [name, role] of demoAccounts) {
      const existingUser = await users.findOne({ tai_khoan: name });

      if (!existingUser) {
        await users.insertOne({
          _id: randomUUID(),
          tai_khoan: name,
          ho_ten: name === 'manager' ? 'Quản lý tòa A' : 'Người xem',
          mat_khau: await hash(
            process.env.DEMO_PASSWORD || adminPassword,
            12,
          ),
          vai_tro: role,
          buildingIds: [IDS.building],
          active: true,
          tokenVersion: 0,
          createdAt: now,
        });
      }
    }
  }
}