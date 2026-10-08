/**
 * The connect panels against the server's Arabic (P1 review).
 *
 * The server's messages tell people which button to press («أعد الربط», «أضف الرقم», «حاول مرة
 * أخرى», «أكمل الربط»). These tests hold the frontend's state logic (connectView.js, orphanView.js,
 * plain ES modules with no React) to that: in the state a message is shown, the button it names is
 * the button on the screen. The frontend has no test runner; the modules are loaded here as
 * scripts, their `export` keywords stripped.
 */
require('./setup');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ERRORS_AR } = require('../src/services/embeddedSignup');
const { REMOVED_AR } = require('../src/services/accountUpdate');

const FRONTEND = path.join(__dirname, '../../frontend/src');

function loadEsm(rel) {
  const src = fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, '');
  const sandbox = {};
  vm.runInNewContext(`${body}\n;__out = { ${names.join(', ')} };`, sandbox);
  return sandbox.__out;
}

const { connectView, BUTTON } = loadEsm('components/whatsapp/connectView.js');
const orphan = loadEsm('pages/admin/orphanView.js');

// «…» quoted inside a message: the button it names.
const namedButtons = (text) => [...String(text).matchAll(/«([^«»]+)»/g)].map((m) => m[1]);

describe('every button a message names is the button shown with it', () => {
  test('revoked: «أعد الربط», which opens Meta\'s window again', () => {
    const view = connectView({ status: 'failed', onb: { step: 'done', revoked: true, last_error_ar: ERRORS_AR.revoked } });
    expect(view).toMatchObject({ kind: 'revoked', action: 'launch', label: 'أعد الربط' });
    expect(namedButtons(ERRORS_AR.revoked)).toEqual([view.label]);
  });

  test('revoked mid-way (a resumable step) still asks for a fresh popup, never /retry', () => {
    expect(connectView({ status: 'failed', onb: { step: 'subscribed', revoked: true } })).toMatchObject({ kind: 'revoked', action: 'launch' });
  });

  test('needs_number: «أضف الرقم», which opens Meta\'s window again; not «SHIFT will finish»', () => {
    const view = connectView({ status: 'needs_number', onb: { step: 'token_exchanged', last_error_ar: ERRORS_AR.needs_number } });
    expect(view).toMatchObject({ kind: 'needs_number', action: 'launch', label: 'أضف الرقم' });
    expect(namedButtons(ERRORS_AR.needs_number)).toEqual([view.label]);
  });

  test('a step the server can resume: «حاول مرة أخرى», which posts /retry', () => {
    for (const step of ['token_exchanged', 'subscribed', 'registered']) {
      const view = connectView({ status: 'failed', onb: { step } });
      expect(view).toMatchObject({ kind: 'steps', action: 'retry', label: 'حاول مرة أخرى' });
    }
    expect(namedButtons(ERRORS_AR.partial)).toEqual([BUTTON.retry]);
    expect(namedButtons(ERRORS_AR.number_not_verified)).toEqual([BUTTON.retry]);
  });

  test('an expired code: «أكمل الربط», which opens Meta\'s window again', () => {
    const view = connectView({ status: 'failed', onb: { step: 'code_received' } });
    expect(view).toMatchObject({ action: 'launch', label: 'أكمل الربط' });
    expect(namedButtons(ERRORS_AR.code_expired)).toEqual([view.label]);
    expect(namedButtons(ERRORS_AR.waba_unresolved)).toEqual([view.label]);
    // After a failed exchange with nothing stored, the screen holds only the server's problem.
    expect(connectView({ status: 'failed', onb: null, problem: { kind: 'server' } })).toMatchObject({ action: 'launch', label: 'أكمل الربط' });
  });

  test('needs_operator has no button: SHIFT finishes it with the token it kept', () => {
    expect(connectView({ status: 'needs_operator', onb: { step: 'token_exchanged' } })).toMatchObject({ kind: 'waiting_operator', action: null });
  });

  test('every button any message names is one the panel has', () => {
    const labels = new Set(Object.values(BUTTON));
    for (const text of Object.values(ERRORS_AR)) {
      for (const name of namedButtons(text)) expect([text, labels.has(name)]).toEqual([text, true]);
    }
  });

  test('ConnectWhatsApp takes its button from connectView, not a fixed «أكمل الربط»', () => {
    const jsx = fs.readFileSync(path.join(FRONTEND, 'components/whatsapp/ConnectWhatsApp.jsx'), 'utf8');
    expect(jsx).toContain("from './connectView'");
    expect(jsx).toMatch(/const buttonLabel = view\.label;/);
  });

  test('the owner\'s removal alert names no button their panel lacks', () => {
    expect(namedButtons(REMOVED_AR)).toEqual([]);
  });
});

describe('«ربط بدون حساب» offers only what the server accepts', () => {
  test('a row that already has a shop (needs number) is completed, never attached', () => {
    expect(orphan.orphanActions({ kind: 'onboarding', needs: 'number', business_id: 'b1' })).toEqual({ attach: false, complete: true });
    expect(orphan.orphanActions({ kind: 'onboarding', needs: 'attach', phone_number_id: '1' })).toEqual({ attach: true, complete: false });
    expect(orphan.orphanActions({ kind: 'partner_added', needs: 'attach' })).toEqual({ attach: true, complete: false });
  });

  test('a 409 business_connected asks to confirm, and the confirmed attach sends replace', () => {
    const err = { response: { status: 409, data: { error: 'business_connected', message: 'أكّد الاستبدال' } } };
    expect(orphan.needsReplaceConfirm(err)).toBe(true);
    expect(orphan.needsReplaceConfirm({ response: { status: 409, data: { error: 'already_attached' } } })).toBe(false);
    expect(orphan.attachBody('b1')).toEqual({ business_id: 'b1' });
    expect(orphan.attachBody('b1', true)).toEqual({ business_id: 'b1', replace: true });
  });

  test('a row with a number is never labelled «الرقم غير محدد»', () => {
    expect(orphan.orphanNumber({ display_phone: '+962 7 9555 0101', phone_number_id: '1' })).toEqual({ text: '+962 7 9555 0101', tone: 'number' });
    expect(orphan.orphanNumber({ phone_number_id: '1' }).text).not.toBe('الرقم غير محدد');
    expect(orphan.orphanNumber({ phone_number_id: null })).toEqual({ text: 'الرقم غير محدد', tone: 'missing' });
  });
});
