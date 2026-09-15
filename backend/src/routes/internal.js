/**
 * Internal machine-to-machine routes (pr1-contracts §8.2).
 *
 * Called by Cloud Scheduler every minute and by the owner's status curl. Mounted without the
 * apiLimiter: a scheduler job must never be throttled into silence. Bearer token only in PR1;
 * an unset token disables the routes (503) instead of leaving them open.
 */

const express = require('express');
const crypto = require('crypto');
const { runSweep, getShiftStatus } = require('../services/shiftSweeper');

const router = express.Router();

function requireSweepToken(req, res, next) {
  const expected = process.env.INTERNAL_SWEEP_TOKEN;
  if (!expected) {
    console.warn('[internal] INTERNAL_SWEEP_TOKEN not set');
    return res.status(503).json({ error: 'sweep_not_configured' });
  }
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on buffers of different lengths.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

router.post('/sweep', requireSweepToken, async (req, res) => {
  try {
    res.json({ ok: true, report: await runSweep() });
  } catch (err) {
    console.error('[internal] sweep failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/shift-status', requireSweepToken, async (req, res) => {
  try {
    res.json(await getShiftStatus());
  } catch (err) {
    console.error('[internal] shift-status failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
