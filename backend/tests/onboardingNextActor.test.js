/**
 * «المطلوب من» on the «الانضمام» list comes from the server: deriveCard's next_actor, made from the
 * same facts as the stage and the reason, so the board never reads it back out of reason_ar's
 * wording (which changes). The board's cardNextActor takes it as sent and only falls back to the
 * card's flags for a card without it.
 */
require('./setup');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { deriveCard } = require('../src/routes/adminAccounts');

const FRONTEND = path.join(__dirname, '../../frontend/src');

function loadEsm(rel) {
  const src = fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const sandbox = {};
  vm.runInNewContext(`${src.replace(/^export\s+/gm, '')}\n;__out = { ${names.join(', ')} };`, sandbox);
  return sandbox.__out;
}
const { cardNextActor } = loadEsm('pages/admin/boardCardView.js');

const NOW = new Date('2026-10-15T10:00:00Z');
const OLD = new Date('2026-10-12T10:00:00Z');
const LATER = new Date('2026-10-20T10:00:00Z');
const OWNER = { name: 'أبو خالد', last_login: null };
const SIGNED_IN = { name: 'أبو خالد', last_login: OLD };

const derive = (over = {}) => deriveCard({
  business: { id: 'b1', name: 'مطعم الشام', wa_phone_number_id: null, created_at: OLD, ...over.business },
  owner: over.owner === undefined ? SIGNED_IN : over.owner,
  invite: over.invite || null,
  onboarding: over.onboarding || null,
  knowledge: over.knowledge || [],
  events: over.events || [],
  now: NOW,
  ownerConnect: over.ownerConnect === undefined ? true : over.ownerConnect,
});
const ev = (type, data = {}) => ({ type, created_at: OLD, data });

describe('أُرسل الرابط', () => {
  test('a link made but never shared is SHIFT\'s to send', () => {
    const { stage, card } = derive({ owner: OWNER, invite: { expires_at: LATER }, events: [ev('invite_created')] });
    expect(stage).toBe('invite_sent');
    expect(card).toMatchObject({ next_actor: 'shift', invite_shared_at: null });
  });

  test('a shared live link is the owner\'s to open, and says when it was shared', () => {
    const { card } = derive({ owner: OWNER, invite: { expires_at: LATER }, events: [ev('invite_shared'), ev('invite_created')] });
    expect(card.next_actor).toBe('owner');
    expect(card.invite_shared_at).toEqual(OLD);
  });

  test('an expired or missing link, or no owner login, is SHIFT\'s', () => {
    expect(derive({ owner: OWNER, invite: { expires_at: OLD }, events: [ev('invite_shared')] }).card.next_actor).toBe('shift');
    expect(derive({ owner: OWNER, invite: null }).card.next_actor).toBe('shift');
    expect(derive({ owner: null }).card.next_actor).toBe('shift');
  });

  test('opened but no password yet: the owner\'s', () => {
    expect(derive({ owner: OWNER, invite: { expires_at: LATER }, events: [ev('join_opened')] }).card.next_actor).toBe('owner');
  });
});

describe('يربط واتساب', () => {
  test('owner button open and nothing tried: the owner\'s; closed: SHIFT connects with them', () => {
    expect(derive({}).card).toMatchObject({ next_actor: 'owner' });
    expect(derive({ ownerConnect: false }).card).toMatchObject({ next_actor: 'shift' });
  });

  test('a cancelled Meta window is the owner\'s to try again', () => {
    const { stage, card } = derive({ events: [ev('es_cancelled', { source: 'browser', current_step: 'PHONE_VERIFICATION' })] });
    expect(stage).toBe('connecting');
    expect(card.next_actor).toBe('owner');
  });

  test('a failure on our side of the window, a conflict, a wrong number or a revoked grant: SHIFT\'s', () => {
    expect(derive({ events: [ev('es_failed', { stage: 'register', error_code: 133005 })] }).card.next_actor).toBe('shift');
    expect(derive({ events: [ev('es_conflict')] }).card.next_actor).toBe('shift');
    expect(derive({ events: [{ ...ev('wrong_number'), resolved_at: null }] }).card.next_actor).toBe('shift');
    expect(derive({ onboarding: { needs_operator: true } }).card.next_actor).toBe('shift');
    expect(derive({ onboarding: { revoked_at: OLD } }).card.next_actor).toBe('shift');
  });
});

describe('after the connect', () => {
  const CONNECTED = { wa_phone_number_id: 'P1', connected_at: OLD };

  test('no card yet, no knowledge, no first customer: the owner\'s', () => {
    expect(derive({ business: CONNECTED, onboarding: { step: 'done' } })).toMatchObject({ stage: 'awaiting_card', card: { next_actor: 'owner' } });
    expect(derive({ business: CONNECTED, onboarding: { step: 'done', payment_method_ok: true } }))
      .toMatchObject({ stage: 'teaching', card: { next_actor: 'owner' } });
    expect(derive({ business: CONNECTED, onboarding: { step: 'done', payment_method_ok: true }, knowledge: [{ created_at: OLD }] }))
      .toMatchObject({ stage: 'awaiting_first_customer', card: { next_actor: 'owner' } });
  });

  test('a claimed, unconfirmed card is SHIFT\'s to confirm', () => {
    const { stage, card } = derive({ business: CONNECTED, onboarding: { step: 'done', payment_method_ok: false, payment_method_claimed_at: OLD } });
    expect(stage).toBe('teaching');
    expect(card).toMatchObject({ payment_claimed: true, next_actor: 'shift' });
  });

  test('a live shop owes nobody a move', () => {
    const { stage, card } = derive({ business: { ...CONNECTED, went_live_at: OLD }, onboarding: { needs_operator: true } });
    expect(stage).toBe('live');
    expect(card.next_actor).toBeNull();
  });
});

describe('the board reads it', () => {
  test('cardNextActor takes next_actor as sent, null included', () => {
    expect(cardNextActor({ next_actor: 'owner', needs_operator: true }, 'connecting')).toBe('owner');
    expect(cardNextActor({ next_actor: null }, 'live')).toBeNull();
  });

  test('without it, the flags decide; never the reason\'s wording', () => {
    expect(cardNextActor({ needs_operator: true }, 'connecting')).toBe('shift');
    expect(cardNextActor({ invite_expires_at: null }, 'invite_sent')).toBe('shift');
    expect(cardNextActor({ reason_ar: 'بانتظار ربط واتساب مع شِفت' }, 'connecting')).toBe('owner');
    const page = fs.readFileSync(path.join(FRONTEND, 'pages/admin/OnboardingBoardPage.jsx'), 'utf8');
    expect(page).not.toMatch(/SHIFT_REASONS|reason_ar\)/);
    expect(page).toMatch(/cardNextActor\(card, stage\)/);
  });
});
