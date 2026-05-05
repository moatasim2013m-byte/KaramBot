// ----------------------------------------------------------------------------
// Staff sound system — original Web Audio synthesis only.
//
// Design rules (from CREDIT-CONTROL spec):
//   • NO copyrighted / iPhone / WhatsApp tones.
//   • NO new packages, NO audio file assets.
//   • NO backend or business-logic changes.
//   • Toggleable via the existing `staff_sound_alerts` localStorage flag.
//   • Each event has its own short cooldown so it can never double-fire for
//     the same logical action (React strict-mode double-invoke, rapid
//     re-clicks, polling re-renders, etc.).
//   • A single shared AudioContext is reused across calls so we don't leak
//     contexts in browsers that throttle them (Safari especially).
//
// All four events are pure-synthesised tones — we pick original frequency
// pairs that don't match any commercial product cue, so the cues feel
// familiar but are demonstrably original.
// ----------------------------------------------------------------------------

const STORAGE_KEY = 'staff_sound_alerts';

const COOLDOWNS_MS = {
  bookingArrival: 1200,
  scanDetected: 600,
  activationSuccess: 1500,
  scanError: 800
};

const lastFiredAt = {
  bookingArrival: 0,
  scanDetected: 0,
  activationSuccess: 0,
  scanError: 0
};

let sharedCtx = null;

const isEnabled = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const getCtx = () => {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
};

// Schedule a single oscillator with a soft attack + exponential decay
// envelope. Returns the absolute end time (ctx.currentTime + offset + duration).
const scheduleNote = (ctx, {
  freq,
  startOffset = 0,
  duration = 0.2,
  peakGain = 0.3,
  type = 'sine',
  attack = 0.015
}) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  const t0 = ctx.currentTime + startOffset;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  return t0 + duration + 0.05;
};

// Build a single play function for a given event key. Encapsulates the
// enabled-check, the cooldown, the AudioContext acquisition, and the
// per-event note schedule. The schedule callback receives the ctx and is
// expected to return the latest absolute end time so we can size the
// async cleanup timeout correctly.
const makePlayer = (eventKey, schedule) => () => {
  if (!isEnabled()) return;
  const stamp = Date.now();
  if (stamp - lastFiredAt[eventKey] < COOLDOWNS_MS[eventKey]) return;
  lastFiredAt[eventKey] = stamp;

  const ctx = getCtx();
  if (!ctx) return;

  // Resuming on user-gesture-locked contexts is safe and a no-op when
  // already running. Scanner / button-click paths always satisfy the
  // gesture requirement; the polling-based booking-arrival cue may not,
  // in which case the play simply stays silent — never throws.
  if (ctx.state === 'suspended') {
    try { ctx.resume(); } catch { /* ignore */ }
  }

  try {
    schedule(ctx);
  } catch {
    // Browser refused playback — keep going silently. Toast warnings are
    // intentionally NOT raised here; the caller already shows a toast
    // for the underlying user action.
  }
};

// 1) New booking received — soft two-note ping (G5 → C6).
// Original pair, not the iPhone tri-tone (D5+F5+A5+D6) and not WhatsApp's
// signature. Soft envelope so it carries through reception noise without
// becoming harsh on repeated triggers.
export const playBookingArrival = makePlayer('bookingArrival', (ctx) => {
  scheduleNote(ctx, { freq: 783.99,  startOffset: 0.00, duration: 0.18, peakGain: 0.32 });
  scheduleNote(ctx, { freq: 1046.50, startOffset: 0.08, duration: 0.26, peakGain: 0.30 });
});

// 2) QR detected / validated — short technical blip (1480 Hz).
// Bright + brief = "scanner reads code" semantic. Frequency chosen to sit
// well above booking + activation cues so it can't be mistaken for either.
export const playScanDetected = makePlayer('scanDetected', (ctx) => {
  scheduleNote(ctx, {
    freq: 1480, startOffset: 0.0, duration: 0.07, peakGain: 0.28, attack: 0.005
  });
});

// 3) Session activation success — warm ascending fifth (E5 → B5).
// Identical timing to the existing on-page chime so familiarity is
// preserved; pure synthesis means no asset migration needed.
export const playActivationSuccess = makePlayer('activationSuccess', (ctx) => {
  scheduleNote(ctx, { freq: 659.25, startOffset: 0.00, duration: 0.22, peakGain: 0.35 });
  scheduleNote(ctx, { freq: 987.77, startOffset: 0.13, duration: 0.30, peakGain: 0.32 });
});

// 4) Error / invalid scan — low descending double-beep.
// Triangle wave for a less-harsh tone, low frequencies for the universal
// "something is wrong" semantic. Distinct from any of the three positive
// cues above (different waveform + much lower pitch).
export const playScanError = makePlayer('scanError', (ctx) => {
  scheduleNote(ctx, {
    freq: 220.00, startOffset: 0.00, duration: 0.10, peakGain: 0.30,
    type: 'triangle', attack: 0.005
  });
  scheduleNote(ctx, {
    freq: 164.81, startOffset: 0.16, duration: 0.12, peakGain: 0.30,
    type: 'triangle', attack: 0.005
  });
});

// Small helper used by the toggle UI so the rest of the page doesn't have
// to duplicate the storage key. Keeps `staff_sound_alerts` as the single
// source of truth.
export const STAFF_SOUND_STORAGE_KEY = STORAGE_KEY;
