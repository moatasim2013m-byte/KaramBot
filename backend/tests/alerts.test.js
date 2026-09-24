/**
 * services/alerts.js (D7): optional webhook + WhatsApp staff numbers inside their 24 h window.
 * Alerts are best effort and must never throw into the reply path.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => ({
  conversation: { findFirst: jest.fn(), create: jest.fn() },
  message: { create: jest.fn() },
}));
jest.mock('../src/services/whatsapp', () => ({ sendText: jest.fn(), sendTemplate: jest.fn() }));

const axios = require('axios');
const prisma = require('../src/config/prisma');
const { sendText, sendTemplate } = require('../src/services/whatsapp');
const { encrypt } = require('../src/utils/tokenCrypto');
const {
  sendStaffAlert, alertChannelConfigured, formatAlertText, ALERT_REASONS, ALERT_TEMPLATE_BODY,
  templateVar, alertTemplateParams, alertTemplate, renderAlertTemplate,
} = require('../src/services/alerts');

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
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('[alerts] skip wa', '962792222222', 'outside window (no ai_config.alert_template)');
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

describe('formatAlertText link line', () => {
  test('an Inbox line when a link is given, and still no raw conversation id', () => {
    // The id was removed from alert text deliberately: staff read these on their own phones and
    // «conversation=cmu0x…» is noise to everyone not debugging. The link replaces it usefully.
    const text = formatAlertText({ reason: 'new_message', conversation, summary: '«مرحبا»', link: 'https://app.test/inbox' });
    expect(text).toBe('🔔 SHIFT bot — رسالة جديدة من عميل\nالعميل: محمد (+962791111111)\n«مرحبا»\nInbox: https://app.test/inbox');
    expect(text).not.toContain('conversation=');
  });
});

describe('template variables (Meta rules)', () => {
  test('newlines become « · », tabs and runs of spaces collapse, never empty', () => {
    expect(templateVar('سطر أول\nسطر ثاني\r\n\nثالث')).toBe('سطر أول · سطر ثاني · ثالث');
    expect(templateVar('a\tb      c')).toBe('a b c');
    expect(templateVar('\n  \n')).toBe('-');
    expect(templateVar(null)).toBe('-');
    expect(templateVar('  نص  ')).toBe('نص');
    for (const v of [templateVar('x\n\n\ty     z'), templateVar(' a ')]) {
      expect(v).not.toMatch(/[\n\t\r]| {5,}/);
    }
  });

  test('cut to 200 code points with an ellipsis; emoji are never split', () => {
    const long = 'ب'.repeat(500);
    const out = templateVar(long);
    expect(Array.from(out)).toHaveLength(200);
    expect(out.endsWith('…')).toBe(true);
    const emoji = templateVar('😀'.repeat(300), 10);
    expect(Array.from(emoji)).toHaveLength(10);
    expect(emoji).toBe(`${'😀'.repeat(9)}…`);
    expect(templateVar('قصير', 200)).toBe('قصير');
  });

  test('params: label, «name (+number)», flattened summary', () => {
    expect(alertTemplateParams({ reason: 'new_message', conversation, summary: '«مرحبا»\nمن إعلان: عرض شِفت' }))
      .toEqual(['رسالة جديدة من عميل', 'محمد (+962791111111)', '«مرحبا» · من إعلان: عرض شِفت']);
    expect(alertTemplateParams({ reason: 'calendly_unmatched', conversation: null, summary: '' }))
      .toEqual(['حجز Calendly بدون محادثة واتساب', '-', '-']);
  });

  test('the approved body neither starts nor ends with a variable; rendered copy fills it in', () => {
    expect(ALERT_TEMPLATE_BODY).not.toMatch(/^\s*\{\{/);
    expect(ALERT_TEMPLATE_BODY).not.toMatch(/\}\}\s*[.!؟]?\s*$/);
    expect(ALERT_TEMPLATE_BODY.match(/\{\{\d+\}\}/g)).toEqual(['{{1}}', '{{2}}', '{{3}}']);
    expect(renderAlertTemplate({ name: 'staff_alert' }, ['L', 'C', 'S']))
      .toBe('[قالب staff_alert] تنبيه لفريق شِفت: L\nالعميل: C\nالتفاصيل: S\nافتح صندوق الرسائل للرد.');
  });

  test('alert_template config: object, bare name, invalid → null', () => {
    expect(alertTemplate(business({ alert_template: { name: 'staff_alert', language: 'ar' } }))).toEqual({ name: 'staff_alert', language: 'ar' });
    expect(alertTemplate(business({ alert_template: 'staff_alert' }))).toEqual({ name: 'staff_alert', language: 'ar' });
    expect(alertTemplate(business({ alert_template: { name: 'staff_alert', language: 'en_US' } }))).toEqual({ name: 'staff_alert', language: 'en_US' });
    expect(alertTemplate(business({}))).toBeNull();
    expect(alertTemplate(business({ alert_template: { name: 'Staff Alert' } }))).toBeNull();
  });
});

describe('WhatsApp channel — template fallback outside the 24 h window', () => {
  const withTemplate = (extra = {}) => business({
    alert_wa_numbers: ['962792222222'], alert_template: { name: 'staff_alert', language: 'ar' }, ...extra,
  });
  const summary = 'بدو عرض سعر\nعيادة أسنان';

  test('window closed (30 h) → approved template with the three sanitised params, stored in the staff thread', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: hoursAgo(30) });
    sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.tpl' });

    const report = await sendStaffAlert({ reason: 'quote', business: withTemplate(), conversation, summary, now: NOW });

    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'sent_template' }]);
    expect(sendText).not.toHaveBeenCalled();
    const params = ['طلب عرض سعر', 'محمد (+962791111111)', 'بدو عرض سعر · عيادة أسنان'];
    expect(sendTemplate).toHaveBeenCalledWith('PNID', 'plain_token', '962792222222', {
      type: 'template', name: 'staff_alert', language: 'ar', bodyParams: params,
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        business_id: 'biz_shift',
        conversation_id: 'staff_conv',
        direction: 'outbound',
        status: 'sent',
        is_ai_generated: false,
        message_type: 'template',
        text_body: renderAlertTemplate({ name: 'staff_alert' }, params),
        meta_message_id: 'wamid.tpl',
        raw_payload: { kind: 'staff_alert', reason: 'quote', template: { name: 'staff_alert', language: 'ar', params } },
      },
    });
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('reached no staff channel'));
  });

  test('staff number never wrote (no conversation) → template, and a thread is created to store it', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'new_staff_conv' });
    sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.tpl2' });

    const report = await sendStaffAlert({ reason: 'new_message', business: withTemplate(), conversation, summary: '«مرحبا»', now: NOW });

    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'sent_template' }]);
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { business_id: 'biz_shift', customer_wa_id: '962792222222', profile_name: null, status: 'open', ai_enabled: true },
    });
    expect(prisma.message.create.mock.calls[0][0].data.conversation_id).toBe('new_staff_conv');
  });

  test('thread creation races (P2002) → the existing thread is used', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'raced_conv' });
    prisma.conversation.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.tpl3' });

    const report = await sendStaffAlert({ reason: 'handoff', business: withTemplate(), conversation, now: NOW });
    expect(report.whatsapp[0].status).toBe('sent_template');
    expect(prisma.message.create.mock.calls[0][0].data.conversation_id).toBe('raced_conv');
  });

  test('inside the window → free-form text, never the template (free)', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: hoursAgo(1) });
    sendText.mockResolvedValue({ ok: true, id: 'wamid.text' });

    const report = await sendStaffAlert({ reason: 'quote', business: withTemplate(), conversation, summary, now: NOW });
    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'sent' }]);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  test('free-form refused with 131047 (window closed at Meta) → the template goes out instead', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: hoursAgo(23.99) });
    sendText.mockResolvedValue({ ok: false, id: null, reason: 'window', code: 131047, error: 'Re-engagement message' });
    sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.tpl4' });

    const report = await sendStaffAlert({ reason: 'quote', business: withTemplate(), conversation, now: NOW });
    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'sent_template' }]);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(prisma.message.create.mock.calls[0][0].data.message_type).toBe('template');
  });

  test('free-form failing for another reason → failed, no template', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: hoursAgo(1) });
    sendText.mockResolvedValue({ ok: false, id: null, reason: 'rate_limit', error: 'slow down' });
    const report = await sendStaffAlert({ reason: 'quote', business: withTemplate(), conversation, now: NOW });
    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'failed' }]);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  test('Meta refuses the template (not approved / paused) → skipped with a clear log, nothing stored', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: hoursAgo(30) });
    sendTemplate.mockResolvedValue({
      ok: false, id: null, reason: 'template', code: 132001, error: 'Template name does not exist in the translation',
    });

    const report = await sendStaffAlert({ reason: 'new_message', business: withTemplate(), conversation, now: NOW });
    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'skipped' }]);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/skip wa 962792222222: template staff_alert\/ar refused \(reason=template code=132001\)/));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('reached no staff channel'));
  });

  test('a template network failure → failed; a throwing sender → failed; never rejects', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    sendTemplate
      .mockResolvedValueOnce({ ok: false, id: null, reason: 'network', error: 'ENOTFOUND' })
      .mockRejectedValueOnce(new Error('boom'));
    const biz = withTemplate({ alert_wa_numbers: ['962790000001', '962790000002'] });

    await expect(sendStaffAlert({ reason: 'quote', business: biz, conversation, now: NOW })).resolves.toEqual({
      webhook: 'skipped',
      whatsapp: [{ to: '962790000001', status: 'failed' }, { to: '962790000002', status: 'failed' }],
    });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  test('template sent but the Inbox row fails to store → still sent', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'staff_conv', last_inbound_at: null });
    sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.tpl5' });
    prisma.message.create.mockRejectedValue(new Error('db down'));
    const report = await sendStaffAlert({ reason: 'quote', business: withTemplate(), conversation, now: NOW });
    expect(report.whatsapp).toEqual([{ to: '962792222222', status: 'sent_template' }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sent but not stored'));
  });
});

describe('scripts/create-alert-template.js', () => {
  const { templatePayload, parseArgs, EXAMPLE } = require('../scripts/create-alert-template');

  test('payload = the template on Meta: staff_alert / ar / UTILITY, body only, three example values', () => {
    expect(templatePayload()).toEqual({
      name: 'staff_alert',
      language: 'ar',
      category: 'UTILITY',
      components: [{
        type: 'BODY',
        text: 'تنبيه لفريق شِفت: {{1}}\nالعميل: {{2}}\nالتفاصيل: {{3}}\nافتح صندوق الرسائل للرد.',
        example: { body_text: [EXAMPLE] },
      }],
    });
    expect(EXAMPLE).toHaveLength(3);
    // The examples obey the same variable rules the sender enforces.
    for (const v of EXAMPLE) expect(templateVar(v)).toBe(v);
  });

  test('args: --dry-run / --status / --business; bad names refused', () => {
    expect(parseArgs(['--dry-run'])).toMatchObject({ dryRun: true, status: false, business: 'shiftc6f194e723be82b9b363', name: 'staff_alert', language: 'ar' });
    expect(parseArgs(['--status', '--business', 'biz_x'])).toMatchObject({ status: true, business: 'biz_x' });
    expect(() => parseArgs(['--name', 'Staff Alert'])).toThrow();
    expect(() => parseArgs(['--send-now'])).toThrow('unknown argument');
  });
});
