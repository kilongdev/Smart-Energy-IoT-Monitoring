// Run with the source API stopped. Destination must be empty; never deletes data.
import { MongoClient, BSON } from 'mongodb';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

if (process.argv[2] !== '--api-stopped') throw new Error('Stop the source API and pass --api-stopped.');
if (!process.env.MIGRATION_SOURCE_URI || !process.env.MONGO_URI) throw new Error('Missing source or target URI.');
const source = new MongoClient(process.env.MIGRATION_SOURCE_URI, { serverSelectionTimeoutMS: 10000 });
const target = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
const folder = join('.cache', 'mongo-backups', new Date().toISOString().replace(/[:.]/g, '-'));
const report = [];
try {
  await Promise.all([source.connect(), target.connect()]);
  const name = process.env.MONGO_DB || 'smart_energy';
  const from = source.db(name), to = target.db(name);
  if ((await to.listCollections().toArray()).length) throw new Error('DestinationNotEmpty');
  const collections = await from.listCollections().toArray();
  if (!collections.length) throw new Error('SourceEmpty');
  if (collections.some(c => c.type !== 'collection')) throw new Error('UnsupportedCollectionType');
  await mkdir(folder, { recursive: true });
  for (const info of collections) {
    const collection = from.collection(info.name);
    const indexes = await collection.listIndexes().toArray();
    const base = Buffer.from(info.name).toString('hex');
    await writeFile(join(folder, base + '.metadata.json'), BSON.EJSON.stringify({ name: info.name, options: info.options, indexes }));
    await to.createCollection(info.name, info.options);
    const file = await open(join(folder, base + '.bson'), 'wx');
    const digest = createHash('sha256');
    let count = 0, batch = [];
    try {
      for await (const doc of collection.find().sort({ _id: 1 })) {
        const bytes = BSON.serialize(doc);
        await file.writeFile(bytes);
        digest.update(bytes);
        batch.push(doc); count++;
        if (batch.length === 500) { await to.collection(info.name).insertMany(batch); batch = []; }
      }
      if (batch.length) await to.collection(info.name).insertMany(batch);
    } finally { await file.close(); }
    const expected = digest.digest('hex');
    const actualDigest = createHash('sha256');
    let actualCount = 0;
    for await (const doc of to.collection(info.name).find().sort({ _id: 1 })) {
      actualDigest.update(BSON.serialize(doc)); actualCount++;
    }
    if (actualCount !== count || actualDigest.digest('hex') !== expected) throw new Error('VerificationFailed');
    for (const index of indexes) {
      if (index.name === '_id_') continue;
      const { key, v, ns, ...options } = index;
      await to.collection(info.name).createIndex(key, options);
    }
    report.push({ collection: info.name, count, sha256: expected });
    console.log(`${info.name}: ${count} documents verified; indexes copied.`);
  }
  await writeFile(join(folder, 'verified.json'), JSON.stringify(report, null, 2));
  console.log(`Migration verified. BSON backup: ${folder}. Source data retained.`);
} catch (error) {
  console.error(`Migration stopped: ${error.code || error.name}. Target may be partial; do not switch API or rerun without inspection.`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source.close(), target.close()]);
}
