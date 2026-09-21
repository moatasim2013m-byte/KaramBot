/**
 * services/alerts.js (D7): optional webhook + WhatsApp staff numbers inside their 24 h window.
 * Alerts are best effort and must never throw into the reply path.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => ({
  conversation: { findFirst: jest.fn() },
  message: { create: jest.fn() },
}));
jest.mock('../src/services/whatsapp', () => ({ sendText: jest.fn() }));

const axios = require('axios');
const prisma = require('../src/config/prisma');
const { sendText } = require('../src/services/whatsapp');
const { encrypt } = require('../src/utils/tokenCrypto');
const { sendStaffAlert, alertChannelConfigured, formatAlertText, ALERT_REASONS } = require('../src/services/alerts');

const NOW = new Date('2026-09-14T10:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

const conversation = { id: 'conv_1', customer_wa_id: '962791111111', profile_name: 'محمد' };
const business = (aiConfig = {}) => ({
  id: 'biz_shift',
  wa_phone_number_id: 'PNID',
  wa_access_token: encrypt('plain_token'),
  ai_config: aiConfig,
});

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.STAFF_ALERT_WEBHOOK_URL;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.STAFF_ALERT_WEBHOOK_URL;
});

describe('formatAlertText', () => {
  test('plain text with label, customer, summary and conversation id', () => {
    expect(formatAlertText({ reason: 'quote', business: business(), conversation, summary: 'عيادة أسنان، بدها عرض سعر' }))
      .toBe('🔔 SHIFT bot — طلب عرض سعر\nالعميل: محمد (+962791111111)\nعيادة أسنان، بدها عرض سعر');
    expect(formatAlertText({ reason: 'handoff', conversation: { ...conversation, profile_name: null }, summary: '' }))
      .toContain('العميل: - (+962791111111)');
  });

  test('the webhook copy escapes customer text (Slack mentions, disguised links, Discord @everyone)', () => {
    const hostile = { ...conversation, profile_name: '<!here> @everyone' };
    const summary = 'بدي احكي مع موظف <!channel> <https://evil.example/login|افتح Inbox كرم> & @here';
    const text = formatAlertText({ reason: 'handoff', conversation: hostile, summary }, { forWebhook: true });
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain('&lt;!channel&gt; &lt;https://evil.example/login|افتح Inbox كرم&gt; &amp; @\u200bhere');
    expect(text).toContain('العميل: &lt;!here&gt; @\u200beveryone (+962791111111)');
    // The WhatsApp copy stays as the customer wrote it.
    expect(formatAlertText({ reason: 'handoff', conversation: hostile, summary })).toContain(summary);
  });

  test('every reason has an Arabic label', () => {
    for (const reason of ALERT_REASONS) {
      const text = formatAlertText({ reason, conversation, summary: '' });
      expect(text).not.toContain(`— ${reason}\n`);
    }
  });
});

describe('webhook channel', () => {
  test('POSTs {text, reason, conversationId, businessId} with a 5 s timeout', async () => {
    process.env.STAFF_ALERT_WEBHOOK_URL = 'https://hooks.example.test/alert';
    axios.post.mockResolvedValue({ status: 200 });

    const report = await sendStaffAlert({ reason: 'handoff', business: business(), conversation, summary: 'بدو يحكي مع حدا', now: NOW });

    expect(report).toEqual({ webhook: 'sent', whatsapp: [] });
    expect(axios.post).toHaveBeenCalledWith('https://hooks.example.test/alert', {
      text: formatAlertText({ reason: 'handoff', conversation, summary: 'بدو يحكي مع حدا' }, { forWebhook: true }),
      reason: 'handoff',
      conversationId: 'conv_1',
      businessId: 'biz_shift',
    }, { timeout: 5000 });
  });

  test('webhook unset → skipped, no HTTP', async () => {
    const report = await sendStaffAlert({ reason: 'quote', business: business(), conversation, now: NOW });
    expect(report).toEqual({ webhook: 'skipped', whatsapp: [] });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('webhook 500 → resolves with failed, never throws', async () => {
    process.env.STAFF_ALERT_WEBHOOK_URL = 'https://hooks.example.test/alert';
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }));

    await expect(sendStaffAlert({ reason: 'billing', business: business(), conversation, now: NOW }))
      .resolves.toEqual({ webhook: 'failed', whatsapp: [] });
  });

  test('never rejects even with garbage input', async () => {
    await expect(sendStaffAlert()).resolves.toEqual(expect.objectContaining({ whatsapp: [] }));
    await expect(sendStaffAlert({ reason: 'quote', business: null, conversation: null })).resolves.toBeDefined();
  });
});

describe('WhatsApp channel', () => {
  test('staff number messaged 2 h ago → sendText + stored outbound row', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: hoursAgo(2) });
    sendText.mockResolvedValue({ ok: true, id: 'wamid.alert' });

    const report = await sendStaffAlert({
      reason: 'meeting', business: business({ alert_wa_numbers: ['962792222222'] }), conversation, summary: 'بكرا 10–12', now: NOW,
    });

    expect(report).toEqual({ webhook: 'skipped', whatsapp: [{ to: '962792222222', status: 'sent' }] });
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({ where: { business_id: 'biz_shift', customer_wa_id: '962792222222' } });
    const text = formatAlertText({ reason: 'meeting', conversation, summary: 'بكرا 10–12' });
    expect(sendText).toHaveBeenCalledWith('PNID', 'plain_token', '962792222222', text);
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        business_id: 'biz_shift',
        conversation_id: 'staff_conv',
        direction: 'outbound',
        message_type: 'text',
        text_body: text,
        status: 'sent',
        meta_message_id: 'wamid.alert',
        is_ai_generated: false,
        raw_payload: { kind: 'staff_alert', reason: 'meeting' },
      },
    });
  });

  test('staff number last messaged 30 h ago → skipped, nothing sent', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: hoursAgo(30) });

    const report = await sendStaffAlert({
      reason: 'meeting', business: business({ alert_wa_numbers: ['962792222222'] }), conversation, now: NOW,
    });

    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'skipped' }]);
    expect(sendText).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('[alerts] skip wa', '962792222222', 'outside window');
  });

  test('no conversation with that staff number → skipped', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    const report = await sendStaffAlert({ reason: 'quote', business: business({ alert_wa_numbers: ['962792222222'] }), conversation, now: NOW });
    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'skipped' }]);
    expect(sendText).not.toHaveBeenCalled();
  });

  test('a failed send or a DB error is reported per number, never thrown', async () => {
    prisma.conversation.findFirst
      .mockResolvedValueOnce({ id: 'c1', last_inbound_at: hoursAgo(1) })
      .mockRejectedValueOnce(Object.assign(new Error('db down'), { code: 'P1001' }));
    sendText.mockResolvedValue({ ok: false, id: null, reason: 'rate_limit', error: 'slow down' });

    const report = await sendStaffAlert({
      reason: 'ai_failure', business: business({ alert_wa_numbers: ['962790000001', '962790000002'] }), conversation, now: NOW,
    });

    expect(report.whatsapp).toEqual([
      { to: '962790000001', status: 'failed' },
      { to: '962790000002', status: 'failed' },
    ]);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe('alertChannelConfigured', () => {
  test('true with a webhook or staff numbers, false with neither', () => {
    expect(alertChannelConfigured(business())).toBe(false);
    expect(alertChannelConfigured(business({ alert_wa_numbers: [] }))).toBe(false);
    expect(alertChannelConfigured(null)).toBe(false);
    expect(alertChannelConfigured(business({ alert_wa_numbers: ['962792222222'] }))).toBe(true);

    process.env.STAFF_ALERT_WEBHOOK_URL = 'https://hooks.example.test/alert';
    expect(alertChannelConfigured(business())).toBe(true);
    expect(alertChannelConfigured(null)).toBe(true);
  });
});
