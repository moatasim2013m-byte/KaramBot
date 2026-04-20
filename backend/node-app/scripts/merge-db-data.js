#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
const SOURCE_DB_NAME = process.env.SOURCE_DB_NAME || process.env.FROM_DB_NAME || process.env.LEGACY_DB_NAME;
const TARGET_DB_NAME = process.env.TARGET_DB_NAME || process.env.DB_NAME;
const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const OVERWRITE = String(process.env.OVERWRITE || 'false').toLowerCase() === 'true';

if (!MONGO_URL) {
  console.error('Missing Mongo URL. Set MONGO_URL (or MONGODB_URI/MONGO_URI/DATABASE_URL).');
  process.exit(1);
}

if (!SOURCE_DB_NAME || !TARGET_DB_NAME) {
  console.error('Missing db names. Set SOURCE_DB_NAME (or FROM_DB_NAME/LEGACY_DB_NAME) and TARGET_DB_NAME (or DB_NAME).');
  process.exit(1);
}

if (SOURCE_DB_NAME === TARGET_DB_NAME) {
  console.error('SOURCE_DB_NAME and TARGET_DB_NAME cannot be the same.');
  process.exit(1);
}

const BATCH_SIZE = 500;

async function run() {
  console.log('DB_MERGE_START', {
    source_db: SOURCE_DB_NAME,
    target_db: TARGET_DB_NAME,
    dry_run: DRY_RUN,
    overwrite: OVERWRITE
  });

  await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  const client = mongoose.connection.getClient();
  const sourceDb = client.db(SOURCE_DB_NAME);
  const targetDb = client.db(TARGET_DB_NAME);

  const sourceCollections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
  const collectionNames = sourceCollections
    .map((c) => c.name)
    .filter((name) => name && !name.startsWith('system.'));

  const summary = {
    collections: {},
    totalRead: 0,
    totalInserted: 0,
    totalUpdated: 0,
    totalSkippedExisting: 0,
    totalErrors: 0
  };

  for (const collectionName of collectionNames) {
    const sourceCollection = sourceDb.collection(collectionName);
    const targetCollection = targetDb.collection(collectionName);

    const counters = {
      read: 0,
      inserted: 0,
      updated: 0,
      skippedExisting: 0,
      errors: 0
    };

    const cursor = sourceCollection.find({});
    const batch = [];

    const flush = async () => {
      if (batch.length === 0) return;

      if (DRY_RUN) {
        counters.read += batch.length;
        batch.length = 0;
        return;
      }

      const ops = batch.map((doc) => {
        if (doc && doc._id != null) {
          if (OVERWRITE) {
            return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } };
          }
          return { updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } };
        }
        return { insertOne: { document: doc } };
      });

      try {
        const result = await targetCollection.bulkWrite(ops, { ordered: false });
        counters.read += batch.length;
        counters.inserted += result.upsertedCount || 0;
        counters.updated += OVERWRITE ? (result.modifiedCount || 0) : 0;

        if (!OVERWRITE) {
          counters.skippedExisting += Math.max(0, batch.length - (result.upsertedCount || 0));
        }
      } catch (error) {
        counters.read += batch.length;
        counters.errors += batch.length;
        console.error(`DB_MERGE_ERROR collection=${collectionName}`, error?.message || error);
      }

      batch.length = 0;
    };

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      batch.push(doc);
      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
    }

    await flush();

    if (DRY_RUN) {
      const estimatedCount = await sourceCollection.estimatedDocumentCount();
      counters.read = estimatedCount;
    }

    summary.collections[collectionName] = counters;
    summary.totalRead += counters.read;
    summary.totalInserted += counters.inserted;
    summary.totalUpdated += counters.updated;
    summary.totalSkippedExisting += counters.skippedExisting;
    summary.totalErrors += counters.errors;

    console.log('DB_MERGE_COLLECTION', collectionName, counters);
  }

  console.log('DB_MERGE_DONE', summary);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('DB_MERGE_FATAL', error?.stack || error?.message || error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // no-op
  }
  process.exit(1);
});
