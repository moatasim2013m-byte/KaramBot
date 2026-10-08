/**
 * Production timing defaults for Claude Opus 5.5 (2026-10-08): it thinks before every answer (~9–10 s on a
 * SHIFT turn), so the first attempt may take 25 s and a SHIFT turn has 45 s — one answer plus one
 * validator regeneration. tests/setup.js pins the first attempt to 15 s for the schedule tests; this file
 * reads the real default.
 */
require('./setup');

test('without SHIFT_AI_FIRST_ATTEMPT_MS the first attempt may take 25 s', async () => {
  const saved = process.env.SHIFT_AI_FIRST_ATTEMPT_MS;
  delete process.env.SHIFT_AI_FIRST_ATTEMPT_MS;
  try {
    let src;
    jest.isolateModules(() => {
      src = require('fs').readFileSync(require.resolve('../src/ai/provider'), 'utf8');
    });
    expect(src).toMatch(/DEFAULT_FIRST_ATTEMPT_MS = Number\(process\.env\.SHIFT_AI_FIRST_ATTEMPT_MS\) \|\| 25000/);
  } finally {
    process.env.SHIFT_AI_FIRST_ATTEMPT_MS = saved;
  }
});

test('the SHIFT deadline defaults to 45 s in both the workflow and the batcher', () => {
  delete process.env.SHIFT_AI_DEADLINE_MS;
  let shift;
  jest.isolateModules(() => { shift = require('../src/workflows/shift'); });
  expect(shift.AI_DEADLINE_MS).toBe(45000);
  const batcher = require('fs').readFileSync(require.resolve('../src/services/replyBatcher'), 'utf8');
  expect(batcher).toMatch(/SHIFT_AI_DEADLINE_MS\) \|\| 45000/);
});
