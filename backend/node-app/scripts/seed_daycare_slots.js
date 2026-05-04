#!/usr/bin/env node
/**
 * Day Care Slot Seeder — DEV / MANUAL ONLY
 *
 * MISSION 1 NOTICE
 * ================
 * This script is intentionally NOT wired into any production startup,
 * cron, or auto-seeding pipeline. It exists so a developer (or admin
 * over SSH) can manually generate Day Care slots for a date range
 * without touching the customer-facing /api/slots/available endpoint
 * (which never auto-seeds daycare slots — see routes/slots.js).
 *
 * Usage
 * -----
 *   cd /app/backend/node-app
 *   node scripts/seed_daycare_slots.js --start=2026-03-01 --end=2026-03-07
 *   node scripts/seed_daycare_slots.js --start=2026-03-01 --end=2026-03-07 --capacity=10
 *   node scripts/seed_daycare_slots.js --date=2026-03-01 --capacity=8 --dry-run
 *
 * Flags
 *   --start=YYYY-MM-DD     First date to seed (inclusive). Required unless --date is given.
 *   --end=YYYY-MM-DD       Last date to seed  (inclusive). Defaults to --start.
 *   --date=YYYY-MM-DD      Shorthand for --start=X --end=X.
 *   --capacity=N           Per-slot capacity. Defaults to DAYCARE_CONFIG.defaultCapacity.
 *   --dry-run              Print what would be created without touching the DB.
 *
 * Exit codes
 *   0  success
 *   1  bad arguments / DB error
 */

// Load env vars. Production runtime (supervisord) sets these directly,
// but when run by hand we want to fall back to /app/backend/.env (where
// the project actually keeps MONGO_URL) and then to node-app/.env if it
// exists. Both calls are safe — dotenv silently no-ops if the file is
// missing and never overwrites pre-set process.env values.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const { generateDaycareSlotsForDate, DAYCARE_CONFIG } = require('../routes/slots');
const TimeSlot = require('../models/TimeSlot');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseFlags = (argv) => {
  const flags = {};
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    flags[match[1]] = match[2];
  }
  return flags;
};

const fail = (msg) => {
  console.error(`[seed_daycare_slots] ERROR: ${msg}`);
  process.exit(1);
};

const enumerateDates = (startStr, endStr) => {
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    fail(`invalid date range: ${startStr} → ${endStr}`);
  }
  if (end < start) {
    fail(`--end (${endStr}) must be on or after --start (${startStr})`);
  }
  const out = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

const previewSlotsForDate = (date, capacity) => {
  const slots = [];
  let hour = DAYCARE_CONFIG.startHour;
  let minute = DAYCARE_CONFIG.startMinute;
  while (hour < DAYCARE_CONFIG.lastEntryHour ||
         (hour === DAYCARE_CONFIG.lastEntryHour && minute <= DAYCARE_CONFIG.lastEntryMinute)) {
    slots.push({
      date,
      start_time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      capacity
    });
    minute += DAYCARE_CONFIG.intervalMinutes;
    while (minute >= 60) { minute -= 60; hour += 1; }
  }
  return slots;
};

const main = async () => {
  const flags = parseFlags(process.argv);
  const startStr = flags.start || flags.date;
  const endStr = flags.end || flags.date || flags.start;
  if (!startStr || !ISO_DATE_RE.test(startStr)) {
    fail('--start=YYYY-MM-DD (or --date=YYYY-MM-DD) is required');
  }
  if (!ISO_DATE_RE.test(endStr)) {
    fail('--end must be YYYY-MM-DD');
  }

  const capacity = flags.capacity !== undefined ? Number(flags.capacity) : DAYCARE_CONFIG.defaultCapacity;
  if (!Number.isFinite(capacity) || capacity <= 0) {
    fail(`--capacity must be a positive number (got: ${flags.capacity})`);
  }

  const dates = enumerateDates(startStr, endStr);
  console.log(`[seed_daycare_slots] dates=${dates.length} capacity=${capacity} dryRun=${Boolean(flags.dryRun)}`);

  if (flags.dryRun) {
    let total = 0;
    for (const d of dates) {
      const preview = previewSlotsForDate(d, capacity);
      total += preview.length;
      console.log(`  ${d}: would seed ${preview.length} slots (${preview[0]?.start_time}…${preview[preview.length - 1]?.start_time})`);
    }
    console.log(`[seed_daycare_slots] DRY RUN — would create up to ${total} slots (existing rows are skipped).`);
    return;
  }

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) fail('MONGO_URL is not set in /app/backend/node-app/.env');

  await mongoose.connect(mongoUrl);
  try {
    let createdTotal = 0;
    let existingTotal = 0;
    for (const d of dates) {
      const before = await TimeSlot.countDocuments({ date: d, slot_type: 'daycare' });
      const slots = await generateDaycareSlotsForDate(d, { capacity });
      const after = await TimeSlot.countDocuments({ date: d, slot_type: 'daycare' });
      const created = after - before;
      createdTotal += created;
      existingTotal += slots.length - created;
      console.log(`  ${d}: ${created} created, ${slots.length - created} already existed.`);
    }
    console.log(`[seed_daycare_slots] DONE — created=${createdTotal}, already_existing=${existingTotal}, dates=${dates.length}.`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error('[seed_daycare_slots] FATAL:', err);
  process.exit(1);
});
