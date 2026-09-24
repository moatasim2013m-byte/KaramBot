#!/usr/bin/env node
/**
 * A customer persona, played by an outside model, goes through the REAL handover flow against
 * the deployed app: redeems the activation link, sees the dashboard as the API renders it for
 * that login, attempts three tasks, and reports what confused it. Then the admin side reads
 * what the platform recorded about that customer.
 *
 *   node scripts/sim-customer-walkthrough.mjs <secrets-dir> <key> <openrouter-model>
 *
 * <secrets-dir> holds admin.jwt, <key>-business.txt, <key>-activation.txt, persona-<key>.json.
 * It is git-ignored: nothing in it belongs in the repo.
 */
import fs from 'fs';

const BASE = process.env.SIM_BASE || 'https://app.shifts-ai.com';
const [S, KEY, MODEL] = process.argv.slice(2);
const read = (f) => fs.readFileSync(`${S}/${f}`, 'utf8').trim();
const persona = JSON.parse(read(`persona-${KEY}.json`));
const adminJwt = read('admin.jwt');
const businessId = read(`${KEY}-business.txt`);
const token = read(`${KEY}-activation.txt`).split('#')[1];

const log = [];
const note = (stage, data) => {
  log.push({ stage, at: new Date().toISOString(), ...data });
  fs.writeFileSync(`${S}/${KEY}-log.json`, JSON.stringify(log, null, 2));
  console.log(`[${KEY}] ${stage}`);
};

async function api(path, { method = 'GET', body, jwt } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}

async function ask(prompt) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 6000 }),
  });
  const j = await r.json();
  const m = j.choices?.[0]?.message || {};
  const text = m.content || m.reasoning || '';
  const match = text.match(/\{[\s\S]*\}/);
  try { return { raw: text, json: match ? JSON.parse(match[0]) : null }; } catch { return { raw: text, json: null }; }
}

const PERSONA = `أنت ${persona.name}، ${persona.role}. ${persona.background}
أنت لست خبيرًا تقنيًا. تتعامل مع الشاشة كما يتعامل صاحب منشأة حقيقي في إربد: بصبر محدود، وتريد أن تفهم ماذا يعمل هذا الشيء لك.
أجب دائمًا بالعربية، وبصيغة JSON فقط بالحقول المطلوبة.`;

// 1 — the activation link, as the page shows it
const lookup = await api('/api/auth/activate/lookup', { method: 'POST', body: { token } });
const screen1 = `شاشة التفعيل (نص حرفي لما تعرضه الصفحة):
  العنوان: شِفت
  تحت العنوان: فعّل حسابك واختر كلمة المرور
  الاسم المعروض: ${lookup.json?.name}
  البريد المعروض: ${lookup.json?.email}
  حقل: كلمة المرور الجديدة
  حقل: تأكيد كلمة المرور
  زر: تفعيل وتسجيل الدخول
  سطر صغير أسفل الزر: ✓ لن يطّلع أحد في شِفت على كلمة مرورك`;
const a1 = await ask(`${PERSONA}

وصلتك رسالة واتساب من شِفت: «أهلًا، هذا رابط تفعيل حسابك في لوحة كرم بوت. افتحه واختر كلمة مرور.» فتحت الرابط ورأيت:

${screen1}

أجب بـ JSON: {"thoughts": "ما الذي فهمته وما الذي لم تفهمه، بجملتين", "confusion": ["أي شيء غير واضح"], "password": "كلمة مرور من 10 أحرف على الأقل تختارها", "trust": 1-10 كم تثق أن هذا الرابط آمن ورسمي}`);
note('activation_screen', { screen: screen1, persona: a1.json, raw: a1.raw.slice(0, 1500) });

const chosen = a1.json?.password && String(a1.json.password).length >= 10 ? String(a1.json.password) : 'Persona-Pass-2026';
const act = await api('/api/auth/activate', { method: 'POST', body: { token, password: chosen } });
note('activation_result', { status: act.status, signed_in: Boolean(act.json?.token), business_id: act.json?.user?.business_id });
const jwt = act.json?.token;
if (!jwt) { console.log('activation failed', act.status, act.json); process.exit(1); }

// 2 — the dashboard for this login
const [stats, convs, biz] = await Promise.all([
  api('/api/inbox/stats', { jwt }), api('/api/inbox/conversations', { jwt }), api(`/api/businesses/${businessId}`, { jwt }),
]);
const type = biz.json?.business?.business_type;
const sidebar = ['ملخص النشاط', 'المحادثات', 'الطلبات', type === 'restaurant' ? 'القائمة' : 'العيادة', 'التقارير', 'الموظفون', 'الإعدادات'];
const st = stats.json || {};
const screen2 = `بعد التفعيل دخلت مباشرة إلى لوحتك. القائمة الجانبية (من اليمين): ${sidebar.join(' | ')}
الشاشة الحالية «ملخص النشاط» وفيها أربع بطاقات:
  محادثات مفتوحة: ${st.open ?? 0}
  انتظار موظف: ${st.human_takeover ?? 0}
  طلبات اليوم: 0
  إيرادات اليوم: 0.00 JOD
وتحتها قسم «طلبات اليوم» فارغ.
قائمة المحادثات (لو فتحتها): ${(convs.json?.conversations || []).length === 0 ? 'فارغة — لا توجد محادثات بعد' : `${convs.json.conversations.length} محادثة`}.`;
const a2 = await ask(`${PERSONA}

${screen2}

لديك ثلاث مهام. لكل واحدة قل أي عنصر من القائمة الجانبية ستضغط، ولماذا، وماذا تتوقع أن تجد:
1) أين تظهر رسائل زبائنك على واتساب؟
2) أين تتأكد أن رقم واتساب منشأتك موصول بالبوت، وهل هو يعمل الآن؟
3) كيف تعرف ماذا سيقول البوت لزبون يسأل عن ${type === 'restaurant' ? 'الأسعار' : 'موعد'}؟

أجب بـ JSON: {"tasks":[{"task":1,"click":"اسم العنصر","why":"...","expect":"..."},{"task":2,"click":"...","why":"...","expect":"..."},{"task":3,"click":"...","why":"...","expect":"..."}], "first_impression":"جملتان", "confusion":["..."]}`);
note('dashboard_tasks', { screen: screen2, persona: a2.json, raw: a2.raw.slice(0, 2500) });

// 3 — Settings, as it really is for a customer
const b = biz.json?.business || {};
const screen3 = `فتحت «الإعدادات». التبويبات: عام | ذكاء اصطناعي | ${type === 'restaurant' ? 'التوصيل' : 'المواعيد'} | سياسات.
تبويب «عام»: اسم المنشأة: ${b.name} — العنوان: ${b.address || '(فارغ)'} — العملة: ${b.currency}.
تبويب «ذكاء اصطناعي»: تفعيل الذكاء الاصطناعي: مفعّل — شخصية المساعد: (فارغ) — رسالة الترحيب: «${b.ai_config?.greeting_message || ''}».
ملاحظة واقعية: لا توجد في أي مكان من لوحتك بطاقة تقول «واتساب: متصل/غير متصل» ولا زر «ربط واتساب». هذه البطاقة تظهر فقط لموظفي شِفت في لوحتهم الداخلية.
كما لا يوجد مكان تجرّب فيه البوت قبل أن يراسلك زبون حقيقي.`;
const a3 = await ask(`${PERSONA}

${screen3}

أجب بـ JSON: {"reaction":"ماذا شعرت حين لم تجد حالة واتساب أو زر تجربة، بجملتين", "would_call_shift": true, "call_reason":"...", "missing":["أهم 3 أشياء ناقصة بالنسبة لك كصاحب منشأة دافع"], "score": 5, "first_complaint":"أول شيء ستشتكي منه لشِفت"}
(استبدل القيم بما تراه أنت؛ score من 1 إلى 10.)`);
note('settings_and_verdict', { screen: screen3, persona: a3.json, raw: a3.raw.slice(0, 2500) });

// 4 — what the admin panel recorded
const [acct, users, fleet] = await Promise.all([
  api(`/api/admin/accounts/${businessId}`, { jwt: adminJwt }),
  api(`/api/admin/accounts/${businessId}/users`, { jwt: adminJwt }),
  api('/api/admin/overview', { jwt: adminJwt }),
]);
const me = (fleet.json?.accounts || []).find((x) => x.id === businessId);
note('admin_view', {
  checklist: acct.json?.checklist,
  owner_signed_in: users.json?.users?.find((u) => u.role === 'business_owner')?.has_signed_in,
  fleet_row: me ? { lifecycle: me.lifecycle, connection: me.connection, agent: me.agent, contract: me.contract } : null,
  attention_for_me: (fleet.json?.attention || []).filter((x) => x.business_id === businessId),
});
console.log(`[${KEY}] done`);
