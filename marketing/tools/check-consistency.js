#!/usr/bin/env node
/*
  check-consistency.js — sector-consistency + arithmetic gate for shifts-ai.store v2.
  Dependency-free. Loads marketing/site/assets/js/content.js in a vm sandbox and asserts:

    (a) sectors are exactly clinic | restaurant | store, each with every required key
        (and the contract's literal values: labels, exampleName, unit, avgTicket, hours);
    (b) no sector's exampleName / reward / unit string appears inside another sector's
        opsRows, chat, cases, faq (also suggestedQuestions, hoursNote) — in either language.
        A token is exempt where the other sector has the *same* value (restaurant and store
        share the unit «طلب» / "order");
    (c) loyalty arithmetic per sector: points = round(avgTicketJOD * pointsPerJOD),
        remaining = max(0, rewardAt - points) — prints the expected sentence so builders
        can match it byte-for-byte;
    (d) ROI formula (demos.roi.formula) evaluates with each sector's roiDefaults to finite,
        positive numbers; defaults sit inside every slider's [min,max] and on its step grid;
    (e) every {ar,en} object has both keys as non-empty strings (and never only one of them);
    (f) forbidden phrases never appear in an Arabic string:
        «بدلًا منك», «صندوق أسود», «60 ثانية», «مباشر» (plus Live/LIVE as a word in English).

  Extra structural asserts: 8 products with unique keys and exactly one flagship;
  bestFor ⊆ sector keys, worksWith ⊆ product keys; 5 team personas × 5 steps; builder has
  4 questions whose business options are the sector keys; contact sector chip options are
  the sector keys; first Karam bubble of every chat script carries {{name}}; opsRows ≥ 8;
  no functions anywhere in the data.

  Exit 1 with the list of failures, exit 0 with a summary.
  Usage: node marketing/tools/check-consistency.js [path/to/content.js]
*/
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CONTENT_PATH = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "site", "assets", "js", "content.js")
);

const SECTOR_KEYS = ["clinic", "restaurant", "store"];
const FORBIDDEN_AR = ["بدلًا منك", "صندوق أسود", "60 ثانية", "مباشر"];
const FORBIDDEN_EN_WORD = /\b(Live|LIVE)\b/;

// Contract literals — "Sector focus — exactly three" table.
const CONTRACT = {
  clinic: { label: "عيادة", exampleName: "عيادة د. رنا", unit: "موعد", unitPlural: "مواعيد", avgTicketJOD: 35, open: 9, close: 21, fridayClosed: true, extraChat: "friday" },
  restaurant: { label: "مطعم أو كافيه", exampleName: "كافيه زيتون", unit: "طلب", unitPlural: "طلبات", avgTicketJOD: 12, open: 12, close: 24, fridayClosed: false, extraChat: "ramadan" },
  store: { label: "متجر إلكتروني", exampleName: "متجر النور", unit: "طلب", unitPlural: "طلبات", avgTicketJOD: 25, open: 10, close: 22, fridayClosed: false, extraChat: "promo" }
};
// Contract reward strings: the store reward must at least contain «شحن مجاني».
const CONTRACT_REWARD_CONTAINS = { clinic: "جلسة تنظيف مجانية", restaurant: "وجبة مجانية", store: "شحن مجاني" };

const failures = [];
const info = [];
function fail(msg) { failures.push(msg); }

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
let C;
try {
  const src = fs.readFileSync(CONTENT_PATH, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: CONTENT_PATH });
  C = sandbox.window.SHIFT_CONTENT;
} catch (e) {
  console.error("FAIL: cannot load " + CONTENT_PATH + "\n  " + e.message);
  process.exit(1);
}
if (!C || typeof C !== "object") {
  console.error("FAIL: window.SHIFT_CONTENT is not an object");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
function isBi(v) { return isObj(v) && typeof v.ar === "string" && typeof v.en === "string"; }
function walk(node, p, fn) {
  fn(node, p);
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, p + "[" + i + "]", fn));
  else if (isObj(node)) Object.keys(node).forEach((k) => walk(node[k], p + "." + k, fn));
}
function has(obj, key) { return isObj(obj) && Object.prototype.hasOwnProperty.call(obj, key); }
function isLatin(s) { return /^[\x00-\x7F -ɏ‐-‧’“”…·]+$/.test(s); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function containsToken(haystack, token) {
  if (!haystack || !token) return false;
  if (isLatin(token)) return new RegExp("(^|[^A-Za-z])" + escapeRe(token) + "($|[^A-Za-z])", "i").test(haystack);
  return haystack.indexOf(token) !== -1;
}
function onGrid(value, min, step) {
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < 1e-9;
}
function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ---------------------------------------------------------------------------
// Top-level shape
// ---------------------------------------------------------------------------
["ui", "sections", "templates", "sectors", "products", "demos", "team", "contact"].forEach((k) => {
  if (!has(C, k)) fail("top-level: missing key \"" + k + "\"");
});
if (C.defaultSector !== undefined && SECTOR_KEYS.indexOf(C.defaultSector) === -1) {
  fail("defaultSector must be one of " + SECTOR_KEYS.join("|") + ", got " + JSON.stringify(C.defaultSector));
}
["top", "karam", "cases", "products", "loyalty", "attendance", "roi", "team", "builder", "contact", "about"].forEach((id) => {
  const s = C.sections && C.sections[id];
  if (!isObj(s)) return fail("sections." + id + ": missing");
  ["eyebrow", "title", "intro"].forEach((k) => { if (!isBi(s[k])) fail("sections." + id + "." + k + ": missing {ar,en}"); });
});
if (isObj(C.sections)) {
  Object.keys(C.sections).forEach((id) => {
    if (["top", "karam", "cases", "products", "loyalty", "attendance", "roi", "team", "builder", "contact", "about"].indexOf(id) === -1) {
      fail("sections." + id + ": not a contract section id (page order is fixed)");
    }
  });
}
["composed", "ask_about_product", "bundle_quote", "roi_estimate", "builder_plan", "builder_summary", "team_plan",
  "loyalty_earn", "loyalty_unlock", "loyalty_redeem", "attendance_alert_late", "attendance_alert_absent",
  "hours_line_night", "hours_line_morning", "hours_line_peak"].forEach((k) => {
  if (!has(C.templates, k)) fail("templates." + k + ": missing");
});
["cta_whatsapp", "illustrative", "preview", "replay", "ops_title", "ops_subtitle", "phone_caption",
  "phone_business_account", "cases_problem", "cases_karam", "cases_result", "flagship", "add_to_bundle",
  "what_it_does", "best_for", "works_with", "ask_about", "sticky_default", "sticky_bundle", "sticky_contact",
  "team_step_label", "builder_progress", "footer_privacy", "footer_data_deletion", "footer_copyright"].forEach((k) => {
  if (!isBi(C.ui && C.ui[k])) fail("ui." + k + ": missing {ar,en}");
});

// No functions anywhere (pure data)
walk(C, "SHIFT_CONTENT", (node, p) => { if (typeof node === "function") fail(p + ": functions are not allowed in content.js"); });

// ---------------------------------------------------------------------------
// (a) sectors: exactly three, all required keys, contract literals
// ---------------------------------------------------------------------------
const sectors = isObj(C.sectors) ? C.sectors : {};
const presentKeys = Object.keys(sectors);
if (presentKeys.length !== 3 || SECTOR_KEYS.some((k) => presentKeys.indexOf(k) === -1)) {
  fail("(a) sectors must be exactly {" + SECTOR_KEYS.join(", ") + "}, got {" + presentKeys.join(", ") + "}");
}
const REQUIRED_BI = ["label", "exampleName", "unit", "unitPlural", "reward", "hoursNote"];
const REQUIRED_NUM = ["avgTicketJOD", "pointsPerJOD", "rewardAt"];
SECTOR_KEYS.forEach((key) => {
  const s = sectors[key];
  if (!isObj(s)) return;
  const at = "sectors." + key;
  if (s.key !== key) fail(at + ".key must equal \"" + key + "\"");
  REQUIRED_BI.forEach((k) => { if (!isBi(s[k])) fail(at + "." + k + ": missing {ar,en}"); });
  REQUIRED_NUM.forEach((k) => { if (typeof s[k] !== "number" || !(s[k] > 0)) fail(at + "." + k + ": must be a positive number"); });
  if (!isObj(s.hours) || typeof s.hours.open !== "number" || typeof s.hours.close !== "number") fail(at + ".hours: needs {open, close}");
  if (!Array.isArray(s.staffRoles) || !s.staffRoles.length || !s.staffRoles.every(isBi)) fail(at + ".staffRoles: must be a non-empty array of {ar,en}");
  if (!Array.isArray(s.opsRows) || s.opsRows.length < 8) fail(at + ".opsRows: needs at least 8 rows (3 at first paint + 5 streamed)");
  else s.opsRows.forEach((r, i) => { if (!isObj(r) || typeof r.kind !== "string" || !isBi(r.text)) fail(at + ".opsRows[" + i + "]: needs {kind, text:{ar,en}}"); });
  if (!isObj(s.chat)) fail(at + ".chat: missing");
  else {
    ["night", "morning", "peak"].forEach((v) => { if (!Array.isArray(s.chat[v]) || !s.chat[v].length) fail(at + ".chat." + v + ": missing or empty"); });
    Object.keys(s.chat).forEach((v) => {
      const turns = s.chat[v];
      if (!Array.isArray(turns)) return;
      turns.forEach((t, i) => {
        if (!isObj(t) || ["customer", "karam", "system", "book"].indexOf(t.from) === -1 || !isBi(t.text)) fail(at + ".chat." + v + "[" + i + "]: needs {from: customer|karam|system|book, text:{ar,en}}");
      });
      const firstKaram = turns.find((t) => isObj(t) && t.from === "karam");
      if (!firstKaram) fail(at + ".chat." + v + ": has no karam turn");
      else if (firstKaram.text.ar.indexOf("{{name}}") === -1 || firstKaram.text.en.indexOf("{{name}}") === -1) fail(at + ".chat." + v + ": first Karam bubble must carry {{name}} in both languages");
    });
  }
  if (!isObj(s.cases) || !isBi(s.cases.problem) || !isBi(s.cases.karam) || !isBi(s.cases.result)) fail(at + ".cases: needs {problem, karam, result} as {ar,en}");
  if (!Array.isArray(s.faq) || !s.faq.length) fail(at + ".faq: missing or empty");
  else s.faq.forEach((f, i) => { if (!isObj(f) || !isBi(f.q) || !isBi(f.a)) fail(at + ".faq[" + i + "]: needs {q:{ar,en}, a:{ar,en}}"); });
  if (!isObj(s.roiDefaults)) fail(at + ".roiDefaults: missing");
  else ["msgsPerDay", "avgTicketJOD", "missedRate", "replyMinutes"].forEach((k) => {
    if (typeof s.roiDefaults[k] !== "number" || !(s.roiDefaults[k] > 0)) fail(at + ".roiDefaults." + k + ": must be a positive number");
  });
  if (isObj(s.roiDefaults) && s.roiDefaults.avgTicketJOD !== s.avgTicketJOD) fail(at + ".roiDefaults.avgTicketJOD (" + s.roiDefaults.avgTicketJOD + ") must equal avgTicketJOD (" + s.avgTicketJOD + ")");

  // Contract literals
  const c = CONTRACT[key];
  if (isBi(s.label) && s.label.ar !== c.label) fail(at + ".label.ar must be «" + c.label + "», got «" + s.label.ar + "»");
  if (isBi(s.exampleName) && s.exampleName.ar !== c.exampleName) fail(at + ".exampleName.ar must be «" + c.exampleName + "», got «" + s.exampleName.ar + "»");
  if (isBi(s.unit) && s.unit.ar !== c.unit) fail(at + ".unit.ar must be «" + c.unit + "», got «" + s.unit.ar + "»");
  if (isBi(s.unitPlural) && s.unitPlural.ar !== c.unitPlural) fail(at + ".unitPlural.ar must be «" + c.unitPlural + "», got «" + s.unitPlural.ar + "»");
  if (isBi(s.reward) && s.reward.ar.indexOf(CONTRACT_REWARD_CONTAINS[key]) === -1) fail(at + ".reward.ar must contain «" + CONTRACT_REWARD_CONTAINS[key] + "», got «" + s.reward.ar + "»");
  if (s.avgTicketJOD !== c.avgTicketJOD) fail(at + ".avgTicketJOD must be " + c.avgTicketJOD + ", got " + s.avgTicketJOD);
  if (isObj(s.hours)) {
    if (s.hours.open !== c.open || s.hours.close !== c.close) fail(at + ".hours must be " + c.open + "–" + c.close + ", got " + s.hours.open + "–" + s.hours.close);
    if (Boolean(s.hours.fridayClosed) !== c.fridayClosed) fail(at + ".hours.fridayClosed must be " + c.fridayClosed);
  }
  if (isObj(s.chat) && !Array.isArray(s.chat[c.extraChat])) fail(at + ".chat." + c.extraChat + ": required variant for this sector");
});

// ---------------------------------------------------------------------------
// (b) cross-sector leakage
// ---------------------------------------------------------------------------
function sectorTexts(s) {
  const out = [];
  (s.opsRows || []).forEach((r, i) => out.push(["opsRows[" + i + "]", r.text]));
  Object.keys(s.chat || {}).forEach((v) => (s.chat[v] || []).forEach((t, i) => out.push(["chat." + v + "[" + i + "]", t.text])));
  ["problem", "karam", "result"].forEach((k) => s.cases && out.push(["cases." + k, s.cases[k]]));
  (s.faq || []).forEach((f, i) => { out.push(["faq[" + i + "].q", f.q]); out.push(["faq[" + i + "].a", f.a]); });
  (s.suggestedQuestions || []).forEach((q, i) => out.push(["suggestedQuestions[" + i + "]", q]));
  if (s.hoursNote) out.push(["hoursNote", s.hoursNote]);
  return out.filter((e) => isBi(e[1]));
}
function ownValues(s) {
  const v = [];
  ["exampleName", "reward", "unit"].forEach((k) => { if (isBi(s[k])) { v.push(s[k].ar); v.push(s[k].en); } });
  return v;
}
let leakChecks = 0;
SECTOR_KEYS.forEach((a) => {
  const A = sectors[a];
  if (!isObj(A)) return;
  SECTOR_KEYS.forEach((b) => {
    if (a === b) return;
    const B = sectors[b];
    if (!isObj(B)) return;
    const exempt = ownValues(B);
    const texts = sectorTexts(B);
    ["exampleName", "reward", "unit"].forEach((field) => {
      if (!isBi(A[field])) return;
      ["ar", "en"].forEach((lang) => {
        const token = A[field][lang];
        if (exempt.indexOf(token) !== -1) return; // same value in both sectors → not a leak
        texts.forEach(([where, bi]) => {
          leakChecks++;
          if (containsToken(bi[lang], token)) {
            fail("(b) sectors." + b + "." + where + "." + lang + " contains " + a + "." + field + "." + lang + " «" + token + "»: " + JSON.stringify(bi[lang]));
          }
        });
      });
    });
  });
});

// Demos / ui / templates / contact / team / products must not hard-code any sector's
// exampleName or reward (they must read them from the sector).
const HARD_CODE_FIELDS = ["exampleName", "reward"];
["ui", "sections", "templates", "demos", "team", "contact", "products"].forEach((top) => {
  walk(C[top], top, (node) => {
    if (typeof node !== "string") return;
    SECTOR_KEYS.forEach((k) => {
      const s = sectors[k];
      if (!isObj(s)) return;
      HARD_CODE_FIELDS.forEach((f) => {
        if (!isBi(s[f])) return;
        ["ar", "en"].forEach((lang) => {
          if (containsToken(node, s[f][lang])) fail("(b) " + top + " hard-codes " + k + "." + f + "." + lang + " «" + s[f][lang] + "» — demos must read it from the sector");
        });
      });
    });
  });
});

// ---------------------------------------------------------------------------
// (c) loyalty arithmetic
// ---------------------------------------------------------------------------
const loyaltySentences = [];
const loy = C.demos && C.demos.loyalty;
if (!isObj(loy) || !isObj(loy.rules)) fail("(c) demos.loyalty.rules: missing");
SECTOR_KEYS.forEach((key) => {
  const s = sectors[key];
  if (!isObj(s) || typeof s.avgTicketJOD !== "number") return;
  const points = Math.round(s.avgTicketJOD * s.pointsPerJOD);
  const balance = points; // after the first visit
  const remaining = Math.max(0, s.rewardAt - balance);
  if (!(points > 0)) fail("(c) " + key + ": points per visit is not positive (" + points + ")");
  if (isObj(loy) && isObj(loy.rules)) {
    const map = { pointsPerJOD: "pointsPerJOD", rewardAt: "rewardAt", avgTicket: "avgTicketJOD" };
    Object.keys(map).forEach((rk) => {
      const r = loy.rules[rk];
      if (!isObj(r)) return fail("(c) demos.loyalty.rules." + rk + ": missing");
      if (r.sectorKey !== map[rk]) fail("(c) demos.loyalty.rules." + rk + ".sectorKey must be \"" + map[rk] + "\"");
      const v = s[map[rk]];
      if (v < r.min || v > r.max) fail("(c) " + key + "." + map[rk] + " = " + v + " is outside slider range [" + r.min + ", " + r.max + "]");
      else if (!onGrid(v, r.min, r.step)) fail("(c) " + key + "." + map[rk] + " = " + v + " is not on the slider step grid (min " + r.min + ", step " + r.step + ")");
    });
  }
  const tpl = C.templates && C.templates.loyalty_earn;
  const vars = { points, balance, remaining, name: s.exampleName && s.exampleName.ar, reward: s.reward && s.reward.ar };
  const varsEn = { points, balance, remaining, name: s.exampleName && s.exampleName.en, reward: s.reward && s.reward.en };
  const ar = isBi(tpl) ? fill(tpl.ar, vars) : "(templates.loyalty_earn missing)";
  const en = isBi(tpl) ? fill(tpl.en, varsEn) : "(templates.loyalty_earn missing)";
  if (isBi(tpl)) {
    ["points", "balance", "remaining", "reward"].forEach((t) => {
      if (tpl.ar.indexOf("{{" + t + "}}") === -1 || tpl.en.indexOf("{{" + t + "}}") === -1) fail("(c) templates.loyalty_earn must use {{" + t + "}} in both languages");
    });
    if (/\{\{\w+\}\}/.test(ar) || /\{\{\w+\}\}/.test(en)) fail("(c) loyalty sentence for " + key + " still has unfilled tokens");
  }
  loyaltySentences.push({ key, points, balance, remaining, rewardAt: s.rewardAt, ar, en });
});

// ---------------------------------------------------------------------------
// (d) ROI formula with defaults
// ---------------------------------------------------------------------------
const roiResults = [];
const roi = C.demos && C.demos.roi;
if (!isObj(roi) || !Array.isArray(roi.inputs) || !isObj(roi.formula)) fail("(d) demos.roi needs {inputs[], formula{}, outputs[]}");
else {
  const ids = roi.inputs.map((i) => i.id);
  ["msgsPerDay", "missedRate", "avgTicketJOD", "replyMinutes"].forEach((id) => { if (ids.indexOf(id) === -1) fail("(d) demos.roi.inputs is missing \"" + id + "\""); });
  if (typeof roi.formula.loss !== "string" || typeof roi.formula.hours !== "string") fail("(d) demos.roi.formula needs string fields loss and hours");
  const outIds = (roi.outputs || []).map((o) => o.id);
  if (outIds.indexOf("loss") === -1 || outIds.indexOf("hours") === -1) fail("(d) demos.roi.outputs must include loss and hours");
  if ((roi.outputs || []).filter((o) => o.primary).length !== 1) fail("(d) demos.roi.outputs must have exactly one primary output");
  if (!isBi(roi.assumptions)) fail("(d) demos.roi.assumptions: missing {ar,en}");
  const days = roi.constants && roi.constants.daysPerMonth;
  if (days !== 30) fail("(d) demos.roi.constants.daysPerMonth must be 30 (the assumptions note says 30)");

  SECTOR_KEYS.forEach((key) => {
    const s = sectors[key];
    if (!isObj(s) || !isObj(s.roiDefaults)) return;
    const d = s.roiDefaults;
    roi.inputs.forEach((inp) => {
      const v = d[inp.sectorKey];
      if (typeof v !== "number") return fail("(d) " + key + ".roiDefaults." + inp.sectorKey + " missing for input " + inp.id);
      if (v < inp.min || v > inp.max) fail("(d) " + key + ".roiDefaults." + inp.sectorKey + " = " + v + " outside [" + inp.min + ", " + inp.max + "]");
      else if (!onGrid(v, inp.min, inp.step)) fail("(d) " + key + ".roiDefaults." + inp.sectorKey + " = " + v + " not on step grid (min " + inp.min + ", step " + inp.step + ")");
    });
    // Evaluate the formula strings themselves so the data cannot drift from this script.
    const scope = { msgsPerDay: d.msgsPerDay, missedRate: d.missedRate, avgTicketJOD: d.avgTicketJOD, replyMinutes: d.replyMinutes, round: Math.round, max: Math.max, min: Math.min };
    let loss, hours;
    try {
      loss = vm.runInNewContext(roi.formula.loss, Object.assign({}, scope));
      hours = vm.runInNewContext(roi.formula.hours, Object.assign({}, scope));
    } catch (e) {
      return fail("(d) ROI formula does not evaluate for " + key + ": " + e.message);
    }
    if (!Number.isFinite(loss) || !(loss > 0)) fail("(d) ROI loss for " + key + " is not a finite positive number: " + loss);
    if (!Number.isFinite(hours) || !(hours > 0)) fail("(d) ROI hours for " + key + " is not a finite positive number: " + hours);
    if (loss !== Math.round(loss) || hours !== Math.round(hours)) fail("(d) ROI outputs for " + key + " must be integers: loss=" + loss + " hours=" + hours);
    // Independent re-computation (guards against a formula string that silently changed meaning).
    const expLoss = Math.round(d.msgsPerDay * d.missedRate * d.avgTicketJOD * 30);
    const expHours = Math.round(d.msgsPerDay * d.replyMinutes * 30 / 60);
    if (loss !== expLoss) fail("(d) ROI loss for " + key + " = " + loss + " but msgsPerDay×missedRate×avgTicket×30 = " + expLoss);
    if (hours !== expHours) fail("(d) ROI hours for " + key + " = " + hours + " but msgsPerDay×replyMinutes×30/60 = " + expHours);
    roiResults.push({ key, defaults: d, loss, hours });
  });
}

// ---------------------------------------------------------------------------
// (e) every {ar,en} object complete
// ---------------------------------------------------------------------------
let biCount = 0;
walk(C, "SHIFT_CONTENT", (node, p) => {
  if (!isObj(node)) return;
  const hasAr = has(node, "ar"), hasEn = has(node, "en");
  if (!hasAr && !hasEn) return;
  biCount++;
  if (hasAr !== hasEn) return fail("(e) " + p + ": has only one of ar/en");
  ["ar", "en"].forEach((l) => {
    if (typeof node[l] !== "string") fail("(e) " + p + "." + l + ": not a string");
    else if (!node[l].trim()) fail("(e) " + p + "." + l + ": empty string");
  });
});

// ---------------------------------------------------------------------------
// (f) forbidden phrases
// ---------------------------------------------------------------------------
let arStrings = 0;
walk(C, "SHIFT_CONTENT", (node, p) => {
  if (!isObj(node) || typeof node.ar !== "string") return;
  arStrings++;
  FORBIDDEN_AR.forEach((ph) => { if (node.ar.indexOf(ph) !== -1) fail("(f) " + p + ".ar contains forbidden «" + ph + "»: " + JSON.stringify(node.ar)); });
  if (typeof node.en === "string" && FORBIDDEN_EN_WORD.test(node.en)) fail("(f) " + p + ".en contains forbidden \"Live\": " + JSON.stringify(node.en));
});

// ---------------------------------------------------------------------------
// Products / team / builder / contact structure
// ---------------------------------------------------------------------------
const products = Array.isArray(C.products) ? C.products : [];
if (products.length !== 8) fail("products: expected 8, got " + products.length);
const productKeys = products.map((p) => p && p.key);
if (new Set(productKeys).size !== productKeys.length) fail("products: keys are not unique");
if (products.filter((p) => p && p.flagship === true).length !== 1) fail("products: exactly one flagship expected");
if (products[0] && products[0].key !== "karam") fail("products[0] must be karam (full-width flagship card)");
products.forEach((p, i) => {
  const at = "products[" + i + "]";
  if (!isObj(p)) return fail(at + ": not an object");
  ["name", "short", "tagline"].forEach((k) => { if (!isBi(p[k])) fail(at + "." + k + ": missing {ar,en}"); });
  if (typeof p.icon !== "string" || !p.icon) fail(at + ".icon: missing");
  if (!Array.isArray(p.does) || p.does.length < 3 || !p.does.every(isBi)) fail(at + ".does: needs ≥3 {ar,en} lines");
  if (!Array.isArray(p.bestFor) || !p.bestFor.length) fail(at + ".bestFor: missing");
  else p.bestFor.forEach((k) => { if (SECTOR_KEYS.indexOf(k) === -1) fail(at + ".bestFor contains non-sector key \"" + k + "\""); });
  if (!Array.isArray(p.worksWith)) fail(at + ".worksWith: missing");
  else p.worksWith.forEach((k) => { if (productKeys.indexOf(k) === -1) fail(at + ".worksWith contains unknown product \"" + k + "\""); if (k === p.key) fail(at + ".worksWith references itself"); });
  if (p.demo != null && ["karam", "loyalty", "attendance"].indexOf(p.demo) === -1) fail(at + ".demo must be karam|loyalty|attendance|null");
});

const team = Array.isArray(C.team) ? C.team : [];
if (team.length !== 5) fail("team: expected 5 personas, got " + team.length);
team.forEach((t, i) => {
  const at = "team[" + i + "]";
  if (!isObj(t)) return fail(at + ": not an object");
  ["short", "name", "role"].forEach((k) => { if (!isBi(t[k])) fail(at + "." + k + ": missing {ar,en}"); });
  if (!Array.isArray(t.steps) || t.steps.length !== 5 || !t.steps.every(isBi)) fail(at + ".steps: needs exactly 5 {ar,en} steps");
});

const builder = C.demos && C.demos.builder;
if (!isObj(builder) || !Array.isArray(builder.questions) || builder.questions.length !== 4) fail("demos.builder.questions: expected 4 questions");
else {
  const qKeys = builder.questions.map((q) => q.key);
  ["business", "role", "channel", "pain"].forEach((k) => { if (qKeys.indexOf(k) === -1) fail("demos.builder.questions missing \"" + k + "\""); });
  builder.questions.forEach((q, i) => {
    const at = "demos.builder.questions[" + i + "]";
    if (!isBi(q.label) || !isBi(q.prompt)) fail(at + ": needs label and prompt {ar,en}");
    if (!Array.isArray(q.options) || !q.options.length) return fail(at + ".options: empty");
    if (q.key === "business") {
      const keys = q.options.map((o) => o.key).sort();
      if (keys.join(",") !== SECTOR_KEYS.slice().sort().join(",")) fail(at + ".options must be exactly the sector keys, got " + keys.join(","));
      q.options.forEach((o) => { if (!isBi(o.noun)) fail(at + " option " + o.key + ": needs noun {ar,en}"); });
    } else {
      q.options.forEach((o) => { if (!isBi(o.label)) fail(at + " option " + o.key + ": needs label {ar,en}"); });
      if (q.default && !q.options.some((o) => o.key === q.default)) fail(at + ".default \"" + q.default + "\" is not an option");
    }
    if (q.key === "role") q.options.forEach((o) => {
      if (!isBi(o.does) || !Array.isArray(o.tasks) || !o.tasks.length) fail(at + " role " + o.key + ": needs does {ar,en} and tasks[]");
    });
  });
  if (!isObj(builder.channelPhrase) || !isBi(builder.channelPhrase.multi) || !isBi(builder.channelPhrase.single)) fail("demos.builder.channelPhrase needs multi and single {ar,en}");
  const roleKeys = (builder.questions.find((q) => q.key === "role") || { options: [] }).options.map((o) => o.key).sort().join(",");
  const teamKeys = team.map((t) => t.key).sort().join(",");
  if (roleKeys && teamKeys && roleKeys !== teamKeys) fail("builder role keys (" + roleKeys + ") must match team persona keys (" + teamKeys + ")");
}

const contact = C.contact;
if (!isObj(contact) || !Array.isArray(contact.chips)) fail("contact.chips: missing");
else {
  const sectorChip = contact.chips.find((c) => c.key === "sector");
  const needChip = contact.chips.find((c) => c.key === "need");
  if (!sectorChip) fail("contact.chips: missing sector chip");
  else if (!Array.isArray(sectorChip.options) || sectorChip.options.slice().sort().join(",") !== SECTOR_KEYS.slice().sort().join(",")) fail("contact sector chip options must be exactly the sector keys");
  if (!needChip) fail("contact.chips: missing need chip");
  else if (!needChip.multi || !Array.isArray(needChip.options) || !needChip.options.every((o) => isObj(o) && o.key && isBi(o.label))) fail("contact need chip must be multi-select with {key,label:{ar,en}} options");
  if (!Array.isArray(contact.fields) || contact.fields.length !== 2) fail("contact.fields: exactly 2 text fields (name, phone)");
  else contact.fields.forEach((f) => { if (f.required) fail("contact.fields." + f.key + ": must be optional"); });
  ["cta", "helper", "privacy", "opening"].forEach((k) => { if (!isBi(contact[k])) fail("contact." + k + ": missing {ar,en}"); });
  if (!isObj(contact.preview) || contact.preview.typewriterMs !== 600) fail("contact.preview.typewriterMs must be 600");
}
if (C.templates && C.templates.composed && C.templates.composed.max_chars !== 700) fail("templates.composed.max_chars must be 700");

// ---------------------------------------------------------------------------
// Attendance sanity (roster vs staffCount range, statuses, month derivable)
// ---------------------------------------------------------------------------
const att = C.demos && C.demos.attendance;
if (!isObj(att)) fail("demos.attendance: missing");
else {
  const sc = att.rules && att.rules.staffCount;
  if (!isObj(sc) || !Array.isArray(att.roster) || att.roster.length < sc.max) fail("demos.attendance.roster must have at least staffCount.max entries");
  (att.roster || []).forEach((r, i) => {
    if (!isBi(r.name) || ["m", "f"].indexOf(r.gender) === -1 || !(r.arrivalOffsetMin === null || typeof r.arrivalOffsetMin === "number")) fail("demos.attendance.roster[" + i + "]: needs name {ar,en}, gender m|f, arrivalOffsetMin number|null");
  });
  ["idle", "ontime", "late", "absent"].forEach((k) => { if (!isObj(att.statuses) || !isObj(att.statuses[k]) || !isBi(att.statuses[k].label)) fail("demos.attendance.statuses." + k + ": missing label"); });
  if (isObj(att.month)) Object.keys(att.month).forEach((k) => {
    const m = att.month[k];
    if (!isObj(m) || typeof m.formula !== "string" || !isBi(m.assumption)) fail("demos.attendance.month." + k + ": every month figure must carry a formula and a visible assumption {ar,en}");
  });
  const ss = att.rules && att.rules.shiftStart;
  if (isObj(ss) && Array.isArray(ss.options) && ss.options.indexOf(ss.fallback) === -1) fail("demos.attendance.rules.shiftStart.fallback must be one of its options");
  if (!isBi(C.templates.attendance_alert_late_f) || !isBi(C.templates.attendance_alert_absent_f)) fail("templates: attendance_alert_late_f / attendance_alert_absent_f needed for feminine roster names");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log("check-consistency — " + path.relative(process.cwd(), CONTENT_PATH));
console.log("");
console.log("(c) Expected loyalty sentence after the first visit (points = round(avgTicket × pointsPerJOD); remaining = max(0, rewardAt − points)):");
loyaltySentences.forEach((l) => {
  console.log("  " + l.key + ": points=" + l.points + " balance=" + l.balance + " rewardAt=" + l.rewardAt + " remaining=" + l.remaining);
  console.log("     ar: " + l.ar);
  console.log("     en: " + l.en);
});
console.log("");
console.log("(d) ROI with sector defaults (loss = round(msgs × missedRate × avgTicket × 30); hours = round(msgs × replyMin × 30 / 60)):");
roiResults.forEach((r) => {
  console.log("  " + r.key + ": msgsPerDay=" + r.defaults.msgsPerDay + " missedRate=" + r.defaults.missedRate + " avgTicketJOD=" + r.defaults.avgTicketJOD + " replyMinutes=" + r.defaults.replyMinutes + "  →  loss=" + r.loss + " JOD/month, hours=" + r.hours + " h/month");
});
console.log("");

if (failures.length) {
  console.error("FAIL — " + failures.length + " problem" + (failures.length === 1 ? "" : "s") + ":");
  failures.forEach((f, i) => console.error("  " + (i + 1) + ". " + f));
  process.exit(1);
}
console.log("OK — sectors: " + SECTOR_KEYS.join(", ") + " · leak checks: " + leakChecks + " · bilingual objects: " + biCount + " · Arabic strings scanned: " + arStrings + " · products: " + products.length + " · team: " + team.length);
process.exit(0);
