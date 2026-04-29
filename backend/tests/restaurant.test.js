require('./setup');
const { validateAIResult } = require('../src/ai/provider');

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
  // Test the confirmation phrase detection logic inline
  const CONFIRMATION_PHRASES = [
    'yes', 'يس', 'اه', 'آه', 'أكد', 'تأكيد', 'confirm', 'تمام', 'تمم',
    'موافق', 'حسنا', 'حسناً', 'صح', 'صحيح', 'نعم', 'اوكي', 'okay', 'ok',
  ];
  const CANCEL_PHRASES = ['إلغاء', 'cancel', 'لا', 'no', 'بطل', 'مش عارف'];

  function isConfirmation(text) {
    const lower = text.toLowerCase().trim();
    return CONFIRMATION_PHRASES.some(p => lower.includes(p));
  }
  function isCancellation(text) {
    const lower = text.toLowerCase().trim();
    return CANCEL_PHRASES.some(p => lower.includes(p));
  }

  test('تمام is a confirmation', () => expect(isConfirmation('تمام')).toBe(true));
  test('اه is a confirmation', () => expect(isConfirmation('اه')).toBe(true));
  test('نعم is a confirmation', () => expect(isConfirmation('نعم')).toBe(true));
  test('okay is a confirmation', () => expect(isConfirmation('okay')).toBe(true));
  test('ok is a confirmation', () => expect(isConfirmation('ok')).toBe(true));
  test('confirm is a confirmation', () => expect(isConfirmation('confirm')).toBe(true));

  test('لا is a cancellation', () => expect(isCancellation('لا')).toBe(true));
  test('إلغاء is a cancellation', () => expect(isCancellation('إلغاء')).toBe(true));
  test('cancel is a cancellation', () => expect(isCancellation('cancel')).toBe(true));

  test('random text is neither confirmation nor cancellation', () => {
    expect(isConfirmation('ممكن تشرح أكثر')).toBe(false);
    expect(isCancellation('ممكن تشرح أكثر')).toBe(false);
  });
});
