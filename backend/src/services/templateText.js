'use strict';

/**
 * What a template the bot sent actually said, for the Inbox (owner, 2026-10-08: the thread showed
 * «[قالب karam_followup_w1] [متابعة أسبوعية 1/4 — karam_followup_w1] صديقنا · ضايل 5» instead of the
 * message the customer received).
 *
 * The bodies are the APPROVED texts on SHIFT's WABA, read from Graph on 2026-10-08. A template edited on
 * Meta must be edited here too; an unknown name falls back to the stored summary, never to a guess.
 */

const TEMPLATES = {
  karam_followup_w1: {
    body: 'أهلين {{1}} 👋 عرض أكتوبر لأول ١٠ محلات بإربد بس — الشهر الأول ببلاش، وبعدها 19.99 دينار بالشهر. ضايل {{2}} أماكن. بدك أحجزلك مكان قبل ما يخلصوا؟',
    buttons: ['احجزلي مكان', 'مش هلأ', 'إيقاف الرسائل'],
  },
  karam_followup_w2: {
    body: 'مرحبا {{1}}، أكتوبر قرّب يخلص ⏳ وعرض الشهر المجاني بيخلص معه. كم رسالة بتضيع عليك بعد الدوام؟ كرم بيرد عليها كلها — ضايل {{2}} أماكن بالعرض.',
    buttons: ['احجزلي مكان', 'مش هلأ', 'إيقاف الرسائل'],
  },
  karam_followup_w3: {
    body: 'أهلين {{1}}، جرّب قبل ما تقرر: ابعتلي اسم محلك وصنفين بأسعارهم، وبصير البوت تبعك خلال دقيقة 🙌 العرض لأول ١٠ محلات بس — ضايل {{2}} أماكن بس.',
    buttons: ['احجزلي مكان', 'مش هلأ', 'إيقاف الرسائل'],
  },
  karam_followup_w4: {
    body: 'آخر فرصة يا {{1}} 🔥 بعد عرض أكتوبر بيرجع الاشتراك بدون شهر مجاني. إذا بدك مكانك، اكتب «بدي أجرّب» هلأ.',
    buttons: ['احجزلي مكان', 'مش هلأ', 'إيقاف الرسائل'],
  },
};

/** The body with its {{n}} filled from params (1-based); null for a template this file does not know. */
function render(name, params = []) {
  const t = TEMPLATES[name];
  if (!t) return null;
  return t.body.replace(/\{\{(\d+)\}\}/g, (m, n) => {
    const v = params[Number(n) - 1];
    return v === undefined || v === null ? m : String(v);
  });
}

function buttonsOf(name) {
  return TEMPLATES[name] ? TEMPLATES[name].buttons.slice() : [];
}

const SUMMARY_RE = /^\[(?:قالب|template) ([A-Za-z0-9_]+)\]\s*([\s\S]*)$/;
// The weekly follow-up's stored summary before 2026-10-08: «[متابعة أسبوعية 1/4 — karam_followup_w1] الاسم · ضايل 5».
const LEGACY_WEEKLY_RE = /^\[متابعة أسبوعية \d\/\d — [A-Za-z0-9_]+\]\s*(.+?)(?:\s*·\s*ضايل\s*(\d+))?\s*$/;

/**
 * How the Inbox shows a template row: { template, text, buttons }. `text` is the message the customer got
 * when it can be rebuilt, the stored summary (without the «[قالب …]» tag) otherwise.
 */
function display(textBody) {
  const s = typeof textBody === 'string' ? textBody : '';
  const m = SUMMARY_RE.exec(s);
  if (!m) return { template: null, text: s, buttons: [] };
  const name = m[1];
  const rest = m[2].trim();
  const legacy = LEGACY_WEEKLY_RE.exec(rest);
  if (legacy && TEMPLATES[name]) {
    return { template: name, text: render(name, [legacy[1], legacy[2]]), buttons: buttonsOf(name) };
  }
  return { template: name, text: rest, buttons: buttonsOf(name) };
}

module.exports = { TEMPLATES, render, buttonsOf, display };
