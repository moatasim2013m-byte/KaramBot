// Unit-style smoke test for the staff sound system.
// Validates: toggle gating, oscillator counts per event, and cooldown dedup.
// Run with:  node /app/frontend/__tests__/staffSounds.smoke.cjs

const Module = require('module');
const path = require('path');
const fs = require('fs');

// --- Stub the browser globals BEFORE importing the module under test ----------
const oscStarts = [];
let storage = {};

global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }
};

class FakeOscillator {
  constructor(ctx) { this.ctx = ctx; this.frequency = { setValueAtTime() {} }; }
  connect() {}
  start(t) { oscStarts.push({ t, freq: this._freq, type: this.type }); }
  stop() {}
}
class FakeGain {
  constructor() { this.gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  connect() {}
}
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createOscillator() { const o = new FakeOscillator(this); const orig = o.frequency.setValueAtTime; o.frequency.setValueAtTime = (f, t) => { o._freq = f; orig.call(o.frequency, f, t); }; return o; }
  createGain() { return new FakeGain(); }
  resume() {}
  close() { this.state = 'closed'; }
}
global.window = { AudioContext: FakeAudioContext };

// --- Transpile-light loader: strip ESM `export` keywords so plain Node can require ---
const srcPath = path.resolve(__dirname, '..', 'src', 'utils', 'staffSounds.js');
let src = fs.readFileSync(srcPath, 'utf8');
src = src.replace(/export\s+const\s+/g, 'const ').replace(/export\s+\{[^}]*\};?/g, '');
src += '\nmodule.exports = { playBookingArrival, playScanDetected, playActivationSuccess, playScanError, STAFF_SOUND_STORAGE_KEY };';
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(src, srcPath);
const sounds = m.exports;

// --- Tiny assert helpers ------------------------------------------------------
let pass = 0, fail = 0;
const assert = (cond, label) => {
  if (cond) { pass++; console.log('PASS:', label); }
  else { fail++; console.log('FAIL:', label); }
};
const reset = () => { oscStarts.length = 0; };

// --- T1: toggle off blocks all events ----------------------------------------
storage = {}; reset();
sounds.playBookingArrival();
sounds.playScanDetected();
sounds.playActivationSuccess();
sounds.playScanError();
assert(oscStarts.length === 0, 'T1: toggle OFF blocks every event (no oscillators started)');

// --- T2: toggle on emits the right counts per event --------------------------
storage[sounds.STAFF_SOUND_STORAGE_KEY] = 'true';
reset();
sounds.playBookingArrival();
assert(oscStarts.length === 2, `T2a: bookingArrival schedules 2 notes (got ${oscStarts.length})`);
const freqsBooking = oscStarts.map(o => o.freq);
assert(freqsBooking[0] === 783.99 && freqsBooking[1] === 1046.5, 'T2b: bookingArrival uses original G5→C6 (no iPhone tri-tone)');

// 600 ms cooldown for scanDetected, 1500 ms for activationSuccess, 800 ms for
// scanError, 1200 ms for bookingArrival. Bypass cooldowns by waiting.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(1300);
  reset();
  sounds.playScanDetected();
  assert(oscStarts.length === 1, `T3: scanDetected schedules 1 oscillator (got ${oscStarts.length})`);
  assert(oscStarts[0].freq === 1480, 'T3b: scanDetected uses 1480 Hz blip');

  await sleep(700);
  reset();
  sounds.playActivationSuccess();
  assert(oscStarts.length === 2, `T4a: activationSuccess schedules 2 notes (got ${oscStarts.length})`);
  assert(oscStarts[0].freq === 659.25 && oscStarts[1].freq === 987.77, 'T4b: activationSuccess uses E5→B5');

  await sleep(1600);
  reset();
  sounds.playScanError();
  assert(oscStarts.length === 2, `T5a: scanError schedules 2 notes (got ${oscStarts.length})`);
  assert(oscStarts[0].type === 'triangle' && oscStarts[1].type === 'triangle', 'T5b: scanError uses triangle wave (warmer error tone)');
  assert(oscStarts[0].freq === 220 && oscStarts[1].freq === 164.81, 'T5c: scanError uses A3→E3 descending');

  // --- T6: cooldown / dedup ---------------------------------------------------
  await sleep(900);
  reset();
  sounds.playScanDetected();          // first call — fires
  sounds.playScanDetected();          // immediate re-entrant — must be blocked
  sounds.playScanDetected();          // immediate re-entrant — must be blocked
  assert(oscStarts.length === 1, `T6a: scanDetected cooldown blocks rapid duplicates (got ${oscStarts.length}, expected 1)`);

  await sleep(700);                   // > 600 ms cooldown
  reset();
  sounds.playScanDetected();
  assert(oscStarts.length === 1, 'T6b: scanDetected fires again once cooldown elapses');

  // --- T7: events are independent (one cooldown does not block another) ------
  await sleep(700);
  reset();
  sounds.playActivationSuccess();
  sounds.playScanError();
  assert(oscStarts.length === 4, `T7: distinct events are independent (got ${oscStarts.length}, expected 2 + 2 = 4)`);

  console.log('\n--- staffSounds.smoke ---');
  console.log(`pass=${pass}  fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
