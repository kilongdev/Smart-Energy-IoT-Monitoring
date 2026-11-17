import { MongoClient, BSON } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Explicit one-off maintenance; never runs during application startup.
const apply = process.argv.includes('--apply');
const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'smart_energy');
  const collections = ['buildings', 'floors', 'rooms', 'devices'];
  const snapshot = Object.fromEntries(await Promise.all(collections.map(async name =>
    [name, await db.collection(name).find({}).toArray()])));
  const operations = { floors: [], rooms: [], devices: [] };
  const now = new Date();
  const save = (collection, item, fields) => {
    operations[collection].push({ updateOne: {
      filter: { _id: item?._id || randomUUID() },
      update: { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } },
      upsert: true,
    } });
    return operations[collection].at(-1).updateOne.filter._id;
  };
  for (const letter of ['A', 'B', 'C']) {
    const matches = snapshot.buildings.filter(b => b.ten_toa_nha === `Tòa nhà ${letter}`);
    if (matches.length !== 1) throw new Error(`Expected one building ${letter}`);
    const buildingId = matches[0]._id;
    const floors = snapshot.floors.filter(f => f.ma_toa_nha === buildingId).sort((a,b) => a.so_tang-b.so_tang);
    if (floors.length > 5) throw new Error('More than five existing floors; manual review required');
    for (let n = 1; n <= 1; n++) {
      const floor = floors[n-1];
      const floorId = save('floors', floor, { ma_toa_nha: buildingId, buildingId, so_tang: n });
      const rooms = snapshot.rooms.filter(r => r.ma_tang === floorId);
      if (rooms.length > 5) throw new Error('More than five existing rooms; manual review required');
      const assigned = new Map();
      for (const room of rooms) {
        const match = room.ten_phong.match(new RegExp(`^Phòng ${letter}${n}0([1-5])$`));
        if (match) assigned.set(Number(match[1]), room);
      }
      for (const room of rooms.filter(r => ![...assigned.values()].includes(r))) {
        assigned.set([1,2,3,4,5].find(i => !assigned.has(i)), room);
      }
      for (let p = 1; p <= 5; p++) {
        const code = `${letter}${n}0${p}`;
        const room = assigned.get(p);
        const roomId = save('rooms', room, { ma_tang: floorId, buildingId,
          ten_phong: `Phòng ${code}`, loai_phong: room?.loai_phong || 'CLASSROOM' });
        const devices = snapshot.devices.filter(d => d.ma_phong === roomId);
        if (devices.length) {
          for (const device of devices) save('devices', device, {
            ten_thiet_bi: `Gateway phòng ${code}`, buildingId, ma_phong: roomId,
          });
        } else {
          const id = randomUUID();
          save('devices', { _id: id }, { ten_thiet_bi: `Gateway phòng ${code}`,
            buildingId, ma_phong: roomId, chu_de_mqtt: `campus/devices/${id}`,
            chu_ky_gui: 2, cong_suat_dinh_muc: 4000, cho_phep_dieu_khien: true });
        }
      }
    }
  }
  // The agreed campus has only floor 1 in each building.
  const keepFloors = operations.floors.map(op => op.updateOne.filter._id);
  const removedFloors = snapshot.floors.filter(f => !keepFloors.includes(f._id)).map(f => f._id);
  const removedRooms = snapshot.rooms.filter(r => removedFloors.includes(r.ma_tang)).map(r => r._id);
  const removedDevices = snapshot.devices.filter(d => removedRooms.includes(d.ma_phong)).map(d => d._id);
  const relatedFilter = { $or: [
    { ma_thiet_bi: { $in: removedDevices } }, { deviceId: { $in: removedDevices } },
    { ma_phong: { $in: removedRooms } }, { ma_tang: { $in: removedFloors } },
  ] };
  const related = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (collections.includes(name) || name === 'users' || name === 'audit') continue;
    const rows = await db.collection(name).find(relatedFilter).toArray();
    if (rows.length) related[name] = rows;
  }
  console.log('Plan:', Object.fromEntries(Object.entries(operations).map(([k,v]) => [k,v.length])));
  console.log('Archive and remove:', { floors: removedFloors.length, rooms: removedRooms.length,
    devices: removedDevices.length, related: Object.fromEntries(Object.entries(related).map(([k,v]) => [k,v.length])) });
  if (apply) {
    const backup = `.cache/backups/campus-${Date.now()}.json`;
    await mkdir('.cache/backups', { recursive: true });
    await writeFile(backup, BSON.EJSON.stringify({ ...snapshot, related }, { relaxed: false }), { flag: 'wx' });
    console.log('Backup:', backup);
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        for (const [name, ops] of Object.entries(operations)) await db.collection(name).bulkWrite(ops, { session });
        for (const [name, rows] of Object.entries(related)) {
          await db.collection(name).deleteMany({ _id: { $in: rows.map(r => r._id) } }, { session });
        }
        await db.collection('devices').deleteMany({ _id: { $in: removedDevices } }, { session });
        await db.collection('rooms').deleteMany({ _id: { $in: removedRooms } }, { session });
        await db.collection('floors').deleteMany({ _id: { $in: removedFloors } }, { session });
      });
    } finally { await session.endSession(); }
    const floors = await db.collection('floors').find({}).toArray();
    const rooms = await db.collection('rooms').find({}).toArray();
    const devices = await db.collection('devices').find({}).toArray();
    if (floors.length !== 3 || rooms.length !== 15 || devices.length !== 15 ||
        floors.some(f => f.so_tang !== 1) ||
        floors.some(f => rooms.filter(r => r.ma_tang === f._id).length !== 5) ||
        rooms.some(r => !devices.some(d => d.ma_phong === r._id && d.buildingId === r.buildingId))) {
      throw new Error('Post-update verification failed');
    }
    console.log(JSON.stringify({ verified: true, buildings: 3, floors: floors.length, rooms: rooms.length, gateways: devices.length }));
  }
} catch (error) {
  console.error(`Campus maintenance failed (${error.name}); credentials withheld.`);
  process.exitCode = 1;
} finally { await client.close(); }
