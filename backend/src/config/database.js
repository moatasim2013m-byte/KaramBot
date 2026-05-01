const prisma = require('./prisma');

async function connectDB() {
  await prisma.$connect();
  console.log('✅ PostgreSQL connected via Prisma');
}

module.exports = { connectDB };
