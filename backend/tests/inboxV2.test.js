/**
 * Inbox v2 API (docs/inbox-v2-port-plan.md) on the in-memory fakeDb.
 *
 * Tenant scoping comes first: the Peekaboo inbox this is ported from keyed everything by phone number
 * and had no business scoping at all.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('./helpers/fakeDb').getFakeDb();

// A bare app: the real one's 100/min apiLimiter would make this suite's request count matter.
const app = express();
app.use(express.json());
app.use('/api/inbox/v2', require('../src/routes/inboxV2'));

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const at = (m) => new Date(T0 + m * MIN);
const auth = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '15m' })}` });
const SARA = auth('u_sara');
const conv = (id) => db.store.conversations.find((c) => c.id === id);

function seed({ conversations = [], messages = [] } = {}) {
  db.seed({
    businesses: [
      { id: 'biz_a', name: 'A', business_type: 'restaurant', wa_phone_number_id: 'pn_a' },
      { id: 'biz_b', name: 'B', business_type: 'clinic', wa_phone_number_id: 'pn_b' },
    ],
    users: [
      { id: 'u_sara', name: 'سارة', role: 'business_owner', business_id: 'biz_a' },
      { id: 'u_omar', name: 'عمر', role: 'staff', business_id: 'biz_a' },
      { id: 'u_gone', name: 'Gone', role: 'staff', business_id: 'biz_a', active: false },
      { id: 'u_bob', name: 'Bob', role: 'business_owner', business_id: 'biz_b' },
      { id: 'u_admin', name: 'Admin', role: 'platform_admin', business_id: null },
    ],
    conversations,
    messages,
  });
}

beforeEach(() => {
  db.reset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('tenant scoping', () => {
  beforeEach(() => seed({
    conversations: [
      { id: 'c_a', business_id: 'biz_a', customer_wa_id: '962790000001', last_message_at: at(1) },
      { id: 'c_b', business_id: 'biz_b', customer_wa_id: '962790000001', last_message_at: at(2) },
    ],
  }));

  const ROUTES = [
    ['get', '/conversations/c_b', null],
    ['get', '/conversations/c_b/messages', null],
    ['post', '/conversations/c_b/read', {}],
    ['post', '/conversations/c_b/labels', { labels: ['x'] }],
    ['post', '/conversations/c_b/snooze', { until: null }],
    ['post', '/conversations/c_b/contact-notes', { notes: 'x' }],
    ['post', '/conversations/c_b/contact-label', { label: 'x' }],
    ['post', '/conversations/c_b/assign', { user_id: null }],
    ['post', '/conversations/c_b/status', { status: 'resolved' }],
    ['post', '/conversations/c_b/attention/clear', {}],
  ];

  test.each(ROUTES)('%s %s on another business\'s conversation is a 404 and changes nothing', async (method, path, body) => {
    const before = JSON.stringify(conv('c_b'));
    let r = request(app)[method](`/api/inbox/v2${path}`).set(SARA);
    if (body) r = r.send(body);
    const res = await r;
    expect(res.status).toBe(404);
    expect(JSON.stringify(conv('c_b'))).toBe(before);
  });

  test('the list and stats never include another business — even with the same customer number', async () => {
    const list = await request(app).get('/api/inbox/v2/conversations').set(SARA);
    expect(list.body.conversations.map((c) => c.id)).toEqual(['c_a']);
    const stats = await request(app).get('/api/inbox/v2/stats').set(SARA);
    expect(stats.body.all).toBe(1);
  });

  test('a platform admin must name the business', async () => {
    const res = await request(app).get('/api/inbox/v2/conversations').set(auth('u_admin'));
    expect(res.status).toBe(400);
    const named = await request(app).get('/api/inbox/v2/conversations?businessId=biz_b').set(auth('u_admin'));
    expect(named.body.conversations.map((c) => c.id)).toEqual(['c_b']);
  });

  test('a conversation cannot be assigned to another business\'s staff, or to a deactivated user', async () => {
    for (const user_id of ['u_bob', 'u_gone', 'nobody']) {
      const res = await request(app).post('/api/inbox/v2/conversations/c_a/assign').set(SARA).send({ user_id });
      expect(res.status).toBe(400);
    }
    expect(conv('c_a').assigned_staff_id).toBeNull();
    const staff = await request(app).get('/api/inbox/v2/staff-list').set(SARA);
    expect(staff.body.staff.map((u) => u.id).sort()).toEqual(['u_omar', 'u_sara']);
  });
});

describe('list filters', () => {
  beforeEach(() => {
    const future = new Date(Date.now() + 3600 * 1000);
    const past = new Date(Date.now() - 3600 * 1000);
    seed({
      conversations: [
        { id: 'c_unread', business_id: 'biz_a', customer_wa_id: '962790000001', unread_count: 2, last_message_at: at(10), labels: ['VIP'] },
        { id: 'c_mine', business_id: 'biz_a', customer_wa_id: '962790000002', assigned_staff_id: 'u_sara', last_message_at: at(9) },
        { id: 'c_omar', business_id: 'biz_a', customer_wa_id: '962790000003', assigned_staff_id: 'u_omar', last_message_at: at(8) },
        { id: 'c_attn', business_id: 'biz_a', customer_wa_id: '962790000004', needs_attention: true, attention_reason: 'human_request', last_message_at: at(7) },
        { id: 'c_snoozed', business_id: 'biz_a', customer_wa_id: '962790000005', snoozed_until: future, unread_count: 1, last_message_at: at(6) },
        { id: 'c_woke', business_id: 'biz_a', customer_wa_id: '962790000006', snoozed_until: past, profile_name: 'Rafat Samara', last_message_at: at(5) },
        { id: 'c_done', business_id: 'biz_a', customer_wa_id: '962790000007', status: 'resolved', last_message_at: at(4) },
      ],
    });
  });

  const ids = async (qs) => (await request(app).get(`/api/inbox/v2/conversations${qs}`).set(SARA)).body.conversations.map((c) => c.id);

  test('all: newest first, without resolved or still-snoozed conversations; an expired snooze is back', async () => {
    expect(await ids('')).toEqual(['c_unread', 'c_mine', 'c_omar', 'c_attn', 'c_woke']);
  });
  test('each tab', async () => {
    expect(await ids('?filter=unread')).toEqual(['c_unread']);
    expect(await ids('?filter=mine')).toEqual(['c_mine']);
    expect(await ids('?filter=unassigned')).toEqual(['c_unread', 'c_attn', 'c_woke']);
    expect(await ids('?filter=attention')).toEqual(['c_attn']);
    expect(await ids('?filter=snoozed')).toEqual(['c_snoozed']);
    expect(await ids('?filter=resolved')).toEqual(['c_done']);
  });
  test('label and search', async () => {
    expect(await ids('?label=VIP')).toEqual(['c_unread']);
    expect(await ids('?search=rafat')).toEqual(['c_woke']);
    expect(await ids('?search=0000002')).toEqual(['c_mine']);
  });
  test('stats match the tabs', async () => {
    const res = await request(app).get('/api/inbox/v2/stats').set(SARA);
    expect(res.body).toEqual({ all: 5, unread: 1, mine: 1, unassigned: 3, attention: 1, snoozed: 1, resolved: 1 });
  });
  test('an unknown filter falls back to all', async () => {
    expect(await ids('?filter=bogus')).toEqual(await ids(''));
  });
});

describe('list pagination and preview', () => {
  test('keyset pages cover every conversation exactly once, even with equal timestamps', async () => {
    seed({
      conversations: Array.from({ length: 23 }, (_, i) => ({
        id: `c${String(i).padStart(2, '0')}`, business_id: 'biz_a', customer_wa_id: `9627900${String(i).padStart(5, '0')}`,
        last_message_at: at(Math.floor(i / 3)), // groups of three share a timestamp
      })),
    });
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      const qs = `?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await request(app).get(`/api/inbox/v2/conversations${qs}`).set(SARA);
      seen.push(...res.body.conversations.map((c) => c.id));
      cursor = res.body.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
  });

  test('a bad cursor is refused', async () => {
    seed();
    const res = await request(app).get('/api/inbox/v2/conversations?cursor=notadate|x').set(SARA);
    expect(res.status).toBe(400);
  });

  test('each row carries its newest message as the preview', async () => {
    seed({
      conversations: [{ id: 'c1', business_id: 'biz_a', customer_wa_id: '962790000001', custom_label: 'أبو أحمد' }],
      messages: [
        { business_id: 'biz_a', conversation_id: 'c1', direction: 'inbound', text_body: 'قديم', created_at: at(1) },
        { business_id: 'biz_a', conversation_id: 'c1', direction: 'outbound', text_body: '  أهلين\n  فيك  ', is_ai_generated: true, created_at: at(2) },
      ],
    });
    const [row] = (await request(app).get('/api/inbox/v2/conversations').set(SARA)).body.conversations;
    expect(row.last_message).toMatchObject({ text: 'أهلين فيك', direction: 'outbound', is_ai_generated: true });
    expect(row.display_name).toBe('أبو أحمد');
  });
});

describe('the thread', () => {
  beforeEach(() => seed({
    conversations: [{ id: 'c1', business_id: 'biz_a', customer_wa_id: '962790000001', unread_count: 4 }],
    messages: [
      ...Array.from({ length: 120 }, (_, i) => ({
        business_id: 'biz_a', conversation_id: 'c1', direction: i % 2 ? 'outbound' : 'inbound',
        text_body: `m${i}`, meta_message_id: `wamid.${i}`, created_at: at(i),
      })),
      { business_id: 'biz_a', conversation_id: 'c1', direction: 'inbound', text_body: 'بالنسبة لهاد', meta_message_id: 'wamid.q', reply_to_message_id: 'wamid.118', created_at: at(200) },
    ],
  }));

  test('opens on the newest page, oldest first, and says whether there is more', async () => {
    const res = await request(app).get('/api/inbox/v2/conversations/c1/messages').set(SARA);
    const texts = res.body.messages.map((m) => m.text_body);
    expect(texts).toHaveLength(50);
    expect(texts[texts.length - 1]).toBe('بالنسبة لهاد');
    expect(texts[0]).toBe('m71');
    expect(res.body.has_older).toBe(true);
  });

  test('`before` pages upward to the very first message', async () => {
    const res = await request(app).get(`/api/inbox/v2/conversations/c1/messages?before=${at(20).toISOString()}`).set(SARA);
    expect(res.body.messages.map((m) => m.text_body)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
    expect(res.body.has_older).toBe(false);
  });

  test('a quoted reply carries what it quotes', async () => {
    const res = await request(app).get('/api/inbox/v2/conversations/c1/messages').set(SARA);
    const reply = res.body.messages.find((m) => m.meta_message_id === 'wamid.q');
    expect(reply.reply_to).toMatchObject({ meta_message_id: 'wamid.118', text: 'm118', direction: 'inbound' });
  });

  test('reading the thread does NOT mark it read — only the explicit call does', async () => {
    // Peekaboo's lesson: a thread open in a background tab silently "read" everything that arrived.
    await request(app).get('/api/inbox/v2/conversations/c1/messages').set(SARA);
    expect(conv('c1').unread_count).toBe(4);

    const res = await request(app).post('/api/inbox/v2/conversations/c1/read').set(SARA);
    expect(res.status).toBe(200);
    expect(conv('c1').unread_count).toBe(0);
    expect(conv('c1').last_staff_read_at).toBeInstanceOf(Date);
  });

  test('a bad `before` is refused', async () => {
    const res = await request(app).get('/api/inbox/v2/conversations/c1/messages?before=yesterday-ish').set(SARA);
    expect(res.status).toBe(400);
  });
});

describe('organising a conversation', () => {
  beforeEach(() => seed({
    conversations: [{ id: 'c1', business_id: 'biz_a', customer_wa_id: '962790000001', needs_attention: true, attention_reason: 'complaint', attention_at: at(1) }],
  }));
  const post = (path, body) => request(app).post(`/api/inbox/v2/conversations/c1${path}`).set(SARA).send(body);

  test('labels are trimmed, de-duplicated case-insensitively, and capped', async () => {
    const res = await post('/labels', { labels: ['  VIP ', 'vip', 'عرض  أكتوبر', '', 7, ...Array.from({ length: 20 }, (_, i) => `l${i}`)] });
    expect(res.body.labels.slice(0, 2)).toEqual(['VIP', 'عرض أكتوبر']);
    expect(res.body.labels).toHaveLength(10);
    expect(conv('c1').labels).toEqual(res.body.labels);
    expect((await post('/labels', { labels: 'VIP' })).status).toBe(400);
  });

  test('snooze: a future time within 90 days; null wakes it', async () => {
    expect((await post('/snooze', { until: new Date(Date.now() - MIN).toISOString() })).status).toBe(400);
    expect((await post('/snooze', { until: new Date(Date.now() + 100 * 24 * 3600 * 1000).toISOString() })).status).toBe(400);
    expect((await post('/snooze', { until: 'soon' })).status).toBe(400);
    const until = new Date(Date.now() + 3600 * 1000);
    expect((await post('/snooze', { until: until.toISOString() })).status).toBe(200);
    expect(conv('c1').snoozed_until.getTime()).toBe(until.getTime());
    await post('/snooze', { until: null });
    expect(conv('c1').snoozed_until).toBeNull();
  });

  test('contact notes and label: text, bounded, blank clears', async () => {
    await post('/contact-notes', { notes: 'بيفضل يتواصل الصبح' });
    expect(conv('c1').contact_notes).toBe('بيفضل يتواصل الصبح');
    expect((await post('/contact-notes', { notes: 'x'.repeat(2001) })).status).toBe(400);
    await post('/contact-notes', { notes: '   ' });
    expect(conv('c1').contact_notes).toBeNull();

    await post('/contact-label', { label: '  أبو   أحمد ' });
    expect(conv('c1').custom_label).toBe('أبو أحمد');
    await post('/contact-label', { label: null });
    expect(conv('c1').custom_label).toBeNull();
  });

  test('assign within the business, and unassign', async () => {
    await post('/assign', { user_id: 'u_omar' });
    expect(conv('c1').assigned_staff_id).toBe('u_omar');
    await post('/assign', { user_id: null });
    expect(conv('c1').assigned_staff_id).toBeNull();
  });

  test('status: resolving clears attention; takeover stays with its own route', async () => {
    expect((await post('/status', { status: 'human_takeover' })).status).toBe(400);
    expect((await post('/status', { status: 'bogus' })).status).toBe(400);
    await post('/status', { status: 'resolved' });
    expect(conv('c1')).toMatchObject({ status: 'resolved', needs_attention: false, attention_reason: null, attention_at: null });
  });

  test('clearing attention', async () => {
    await post('/attention/clear', {});
    expect(conv('c1')).toMatchObject({ needs_attention: false, attention_reason: null });
  });
});

describe('review fixes (2026-10-06)', () => {
  test('contact notes are read back on the conversation — they were write-only', async () => {
    seed({ conversations: [{ id: 'c1', business_id: 'biz_a', customer_wa_id: '962790000001', contact_notes: 'بيفضّل الصبح' }] });
    const res = await request(app).get('/api/inbox/v2/conversations/c1').set(SARA);
    expect(res.body.conversation.contact_notes).toBe('بيفضّل الصبح');
  });

  test('older pages skip nothing when messages share a timestamp at the boundary', async () => {
    const same = at(5);
    seed({
      conversations: [{ id: 'c1', business_id: 'biz_a', customer_wa_id: '962790000001' }],
      messages: ['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: `m_${x}`, business_id: 'biz_a', conversation_id: 'c1', direction: 'inbound', text_body: x, created_at: same })),
    });
    const first = await request(app).get('/api/inbox/v2/conversations/c1/messages?limit=2').set(SARA);
    const seen = first.body.messages.map((m) => m.text_body);
    let top = first.body.messages[0];
    for (let i = 0; i < 5 && top; i += 1) {
      const page = await request(app).get(`/api/inbox/v2/conversations/c1/messages?limit=2&before=${encodeURIComponent(new Date(top.created_at).toISOString())}&before_id=${top.id}`).set(SARA);
      if (!page.body.messages.length) break;
      seen.unshift(...page.body.messages.map((m) => m.text_body));
      top = page.body.messages[0];
    }
    expect([...seen].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
