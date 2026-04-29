const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME || 'whatsapp_saas';

  if (!uri) throw new Error('MONGO_URL is not defined in environment variables');

  await mongoose.connect(uri, { dbName });
  console.log(`✅ MongoDB connected: ${dbName}`);
}

module.exports = { connectDB };
