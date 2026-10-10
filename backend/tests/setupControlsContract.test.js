/**
 * The owner's checklist and the «الانضمام» board against what the server sends (P2 review).
 *
 * The server marks the connect step «عليك» with action 'connect' and the hint «اضغط «اربط
 * واتساب»…», and the unclaimed payment step with action 'payment_claim'; the panel showed neither
 * button, so outside /join an owner had nothing to press. The board printed «توقف عند:» before a
 * line that already said it, and never offered «رأيت البطاقة — أكّد» or «اربط معه». These hold
 * the frontend's pure view modules (loaded as scripts, like connectViewContract.test.js) to the
 * server's own output.
 */
require('./setup');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildSetup, explain } = require('../src/routes/whatsappStatus');
const { deriveCard } = require('../src/routes/adminAccounts');

const FRONTEND = path.join(__dirname, '../../frontend/src');

function loadEsm(rel) {
  const src = fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, '');
  const sandbox = {};
  vm.runInNewContext(`${body}\n;__out = { ${names.join(', ')} };`, sandbox);
  return sandbox.__out;
}

const { stepControls, explainControls } = loadEsm('components/whatsapp/setupControls.js');
const { cardLines, cardBadges, cardActions } = loadEsm('pages/admin/boardCardView.js');

const namedButtons = (text) => [...String(text).matchAll(/«([^«»]+)»/g)].map((m) => m[1]);
const kinds = (list) => list.map((c) => c.kind);

const NOT_CONNECTED = { state: 'down' };
const CONNECTED = { state: 'ok' };
const BUSINESS = { business_type: 'generic' };

describe('the checklist', () => {
  test('owners may connect: the connect step has the «اربط واتساب» button its hint names', () => {
    const { steps } = buildSetup({ business: BUSINESS, connection: NOT_CONNECTED, paymentOk: null, knowledgeCount: 0, lastInbound: null, ownerConnect: true });
    const step = steps.find((s) => s.key === 'connected');
    const controls = stepControls(step);
    expect(kinds(controls)).toContain('connect');
    for (const name of namedButtons(step.hint)) expect(controls.map((c) => c.label)).toContain(name);
  });

  test('until then it is SHIFT\'s: no connect button, a waiting note', () => {
    const { steps } = buildSetup({ business: BUSINESS, connection: NOT_CONNECTED, paymentOk: null, knowledgeCount: 0, lastInbound: null, ownerConnect: false });
    expect(kinds(stepControls(steps.find((s) => s.key === 'connected')))).toEqual(['shift_wait']);
  });

  test('an unclaimed card: WhatsApp Manager and «أضفت البطاقة»; once claimed, no claim button', () => {
    const unclaimed = buildSetup({ business: BUSINESS, connection: CONNECTED, paymentOk: false, knowledgeCount: 0, lastInbound: null });
    expect(kinds(stepControls(unclaimed.steps.find((s) => s.key === 'payment')))).toEqual(['manager', 'claim']);
    const claimed = buildSetup({ business: BUSINESS, connection: CONNECTED, paymentOk: false, paymentClaimed: true, knowledgeCount: 0, lastInbound: null });
    expect(stepControls(claimed.steps.find((s) => s.key === 'payment'))).toEqual([]);
  });
});

describe('the status card', () => {
  test('«اربط واتساب» in the body comes with that button, not «راسل فريق شِفت»', () => {
    const ex = explain(NOT_CONNECTED, { state: 'unknown' }, null, null, { ownerConnect: true, hasNumber: false });
    const controls = explainControls(ex, { managerUrl: 'https://x' });
    expect(kinds(controls)).toEqual(['connect']);
    for (const name of namedButtons(ex.body)) expect(controls.map((c) => c.label)).toContain(name);
  });

  test('a card still to add: the claim button beside WhatsApp Manager', () => {
    const pay = explain({ state: 'degraded' }, { state: 'unknown' }, { step: 'done', payment_method_ok: false }, null);
    expect(pay.action).toBe('payment');
    expect(kinds(explainControls(pay, { managerUrl: 'https://x' }))).toEqual(['manager', 'claim']);
  });
});

describe('the board card', () => {
  const NOW = new Date('2026-10-15T10:00:00Z');
  const OLD = new Date('2026-10-12T10:00:00Z');
  const base = (over = {}) => ({
    business: { id: 'b1', name: 'مطعم الشام', wa_phone_number_id: null, created_at: OLD, ...over.business },
    owner: { name: 'أبو خالد', last_login: OLD },
    invite: null,
    onboarding: over.onboarding || null,
    knowledge: over.knowledge || [],
    events: over.events || [],
    now: NOW,
    ownerConnect: true,
  });

  test('a cancelled Meta window reads «توقف عند: …» once, and the same reason is not repeated', () => {
    const { stage, card } = deriveCard(base({
      events: [{ type: 'es_cancelled', created_at: OLD, data: { source: 'browser', current_step: 'PHONE_VERIFICATION' } }],
    }));
    expect(stage).toBe('connecting');
    expect(card.stuck).toBe(true);
    const lines = cardLines(card);
    expect(lines.step.match(/توقف عند:/g)).toHaveLength(1);
    expect(lines.step).not.toMatch(/^توقف عند: (توقف|فشل) عند/);
    expect(lines.reason).toBeNull();
    expect(cardActions(card, stage).map((a) => a.label)).toContain('اربط معه');
  });

  test('a failure reads «فشل عند: …», never «توقف عند: فشل عند»', () => {
    const { card } = deriveCard(base({
      events: [{ type: 'es_failed', created_at: OLD, data: { stage: 'register', error_code: 133005 } }],
    }));
    expect(cardLines(card).step).not.toMatch(/توقف عند: فشل/);
  });

  test('a claimed, unconfirmed card: the badge and «رأيت البطاقة — أكّد»', () => {
    const { stage, card } = deriveCard(base({
      business: { wa_phone_number_id: 'P1', connected_at: OLD },
      onboarding: { step: 'done', payment_method_ok: false, payment_method_claimed_at: OLD },
    }));
    expect(stage).toBe('teaching');
    expect(cardBadges(card, stage).map((b) => b.label)).toContain('بانتظار تأكيد البطاقة');
    expect(cardActions(card, stage).map((a) => a.label)).toContain('رأيت البطاقة — أكّد');

    const confirmed = deriveCard(base({
      business: { wa_phone_number_id: 'P1', connected_at: OLD },
      onboarding: { step: 'done', payment_method_ok: true, payment_method_claimed_at: OLD },
    }));
    expect(cardActions(confirmed.card, confirmed.stage).map((a) => a.kind)).not.toContain('confirm_card');
  });

  test('the board page renders these modules, not its own prefix', () => {
    const page = fs.readFileSync(path.join(FRONTEND, 'pages/admin/OnboardingBoardPage.jsx'), 'utf8');
    expect(page).not.toMatch(/توقف عند: \{card\.last_es_step_ar\}/);
    expect(page).toMatch(/from '\.\/boardCardView'/);
    for (const rel of ['components/whatsapp/SetupGuide.jsx', 'components/whatsapp/WhatsAppStatusCard.jsx']) {
      expect(fs.readFileSync(path.join(FRONTEND, rel), 'utf8')).toMatch(/from '\.\/setupControls'/);
    }
  });
});
