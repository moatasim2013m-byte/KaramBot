#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

const Settings = require('../models/Settings');

async function run() {
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/peekaboo';
  const dbName = process.env.DB_NAME;

  await mongoose.connect(mongoUrl, {
    ...(dbName ? { dbName } : {})
  });

  const result = await Settings.updateOne(
    { key: 'whatsapp_auto_reply_config' },
    {
      $set: {
        'value.useAiFallback': true,
        updated_at: new Date()
      }
    }
  );

  console.log('Matched documents:', result.matchedCount || 0);
  console.log('Modified documents:', result.modifiedCount || 0);
  if (!result.matchedCount) {
    console.log('No settings document found for key "whatsapp_auto_reply_config".');
    console.log('Create it first from admin panel/API, then run this script again.');
  }
}

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Failed to set value.useAiFallback=true:', error.message);
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
    process.exit(1);
  });
