require('dotenv').config();
const { validateEnv } = require('./config/validateEnv');
validateEnv(); // fail fast before anything else loads

const app = require('./app');
const { connectDB } = require('./config/database');
const { resolveModel } = require('./ai/provider');
const { graphVersion } = require('./services/whatsapp');
const { assertButtons } = require('./workflows/shift/buttons');
const { runSweep } = require('./services/shiftSweeper');
const replyBatcher = require('./services/replyBatcher');

const PORT = process.env.PORT || 8080;
const SWEEP_INTERVAL_MS = 60000;

async function start() {
  if (process.env.SKIP_DB_CONNECT === 'true') {
    console.warn('⚠️ DB connection skipped for preview mode');
  } else {
    await connectDB();
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`[ai] model=${resolveModel()} graph=${graphVersion()}`);
    // Fail the revision at boot rather than have Meta reject a slot button in a live chat.
    assertButtons();
    // Backup trigger only: Cloud Scheduler is primary. Useful because CPU stays allocated (D3).
    if (process.env.NODE_ENV !== 'test') {
      setInterval(() => runSweep().catch((e) => console.error('[sweep]', e.message)), SWEEP_INTERVAL_MS).unref();
    }
  });

  // Cloud Run sends SIGTERM on deploy and scale-in, then kills the process 10 s later. Node's default
  // is to exit at once, which can leave a reply's intent row at `sending`; let in-flight sends finish.
  process.once('SIGTERM', async () => {
    console.log('[shutdown] SIGTERM — finishing in-flight replies');
    server.close();
    const drained = await replyBatcher.shutdown(8000).catch(() => false);
    console.log(`[shutdown] ${drained ? 'drained' : 'timed out'} — exiting`);
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
