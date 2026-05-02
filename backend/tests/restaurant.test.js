require('./setup');
const { validateAIResult } = require('../src/ai/provider');
const { isConfirmation, isCancellation } = require('../src/workflows/restaurant');

describe('AI Output Validation', () => {

  test('accepts valid reply with NONE action', () => {
    const result = validateAIResult({ reply: 'كيف أساعدك؟', action: 'NONE', extracted_items: [] });
    expect(result.valid).toBe(true);
  });

  test('accepts result with no action field', () => {
    const result = validateAIResult({ reply: 'مرحباً!' });
    expect(result.valid).toBe(true);
  });

  test('rejects null result', () => {
    expect(validateAIResult(null).valid).toBe(false);
  });

  test('rejects missing reply', () => {
    expect(validateAIResult({ action: 'NONE' }).valid).toBe(false);
  });

  test('rejects empty reply string', () => {
    expect(validateAIResult({ reply: '   ', action: 'NONE' }).valid).toBe(false);
  });

  test('rejects unknown action', () => {
    const result = validateAIResult({ reply: 'test', action: 'MAKE_COFFEE' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unknown action');
  });

  test('rejects non-array extracted_items', () => {
    const result = validateAIResult({ reply: 'test', action: 'ADD_ITEM', extracted_items: 'burger' });
    expect(result.valid).toBe(false);
  });

  test('accepts valid ADD_ITEM with items array', () => {
    const result = validateAIResult({
      reply: 'تم إضافة البرغر',
      action: 'ADD_ITEM',
      extracted_items: [{ name_ar: 'برغر', quantity: 2 }],
    });
    expect(result.valid).toBe(true);
  });
});

describe('Restaurant Confirmation Logic', () => {
  // Uses the actual module functions with token-level matching (not substring/includes).

  // ── Basic confirmations ──────────────────────────────────────────────────────
  test('تمام is a confirmation', () => expect(isConfirmation('تمام')).toBe(true));
  test('اه is a confirmation', () => expect(isConfirmation('اه')).toBe(true));
  test('نعم is a confirmation', () => expect(isConfirmation('نعم')).toBe(true));
  test('okay is a confirmation', () => expect(isConfirmation('okay')).toBe(true));
  test('ok is a confirmation', () => expect(isConfirmation('ok')).toBe(true));
  test('confirm is a confirmation', () => expect(isConfirmation('confirm')).toBe(true));
  test('موافق is a confirmation', () => expect(isConfirmation('موافق')).toBe(true));
  test('صح is a confirmation', () => expect(isConfirmation('صح')).toBe(true));

  // ── Basic cancellations ──────────────────────────────────────────────────────
  test('لا is a cancellation', () => expect(isCancellation('لا')).toBe(true));
  test('إلغاء is a cancellation', () => expect(isCancellation('إلغاء')).toBe(true));
  test('cancel is a cancellation', () => expect(isCancellation('cancel')).toBe(true));
  test('no is a cancellation', () => expect(isCancellation('no')).toBe(true));
  test('بطل is a cancellation', () => expect(isCancellation('بطل')).toBe(true));

  // ── Token-level: no false positives from substring containment ───────────────
  test('"book" does NOT trigger "ok" confirmation (token-level guard)', () =>
    expect(isConfirmation('book')).toBe(false));
  test('"know" does NOT trigger "no" cancellation (token-level guard)', () =>
    expect(isCancellation('know')).toBe(false));
  test('"علا" (a name) does NOT trigger "لا" cancellation (token-level guard)', () =>
    expect(isCancellation('علا')).toBe(false));
  test('"لأن" (because) does NOT trigger "لا" cancellation (token-level guard)', () =>
    expect(isCancellation('لأن')).toBe(false));

  // ── Diacritic / alef normalisation ──────────────────────────────────────────
  test('آه (with madda alef) is a confirmation', () => expect(isConfirmation('آه')).toBe(true));
  test('أكد (with hamza) is a confirmation', () => expect(isConfirmation('أكد')).toBe(true));

  // ── Confirmation / cancellation inside a longer message ─────────────────────
  test('"تمام شكراً" is a confirmation', () => expect(isConfirmation('تمام شكراً')).toBe(true));
  test('"لا، ألغِ الطلب" is a cancellation', () => expect(isCancellation('لا، ألغِ الطلب')).toBe(true));
  test('"مش عارف" is a cancellation', () => expect(isCancellation('مش عارف')).toBe(true));

  // ── Neutral phrases are neither ──────────────────────────────────────────────
  test('random text is not a confirmation', () => expect(isConfirmation('ممكن تشرح أكثر')).toBe(false));
  test('random text is not a cancellation', () => expect(isCancellation('ممكن تشرح أكثر')).toBe(false));
});
