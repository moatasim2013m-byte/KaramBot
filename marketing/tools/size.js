#!/usr/bin/env node
/*
  size.js — weight-budget gate for shifts-ai.store. Dependency-free; gzip level 9 per file (what a static host transfers).

  Two budgets (revised 2026-09-11 when pages became pre-rendered for search engines):
    1. Assets — assets/app.css + assets/js/**.js ≤ 120 KB gz. The code every page downloads and runs; this is the
       original DESIGN-CONTRACT budget and it still applies unchanged.
    2. Pages — each built HTML page ≤ 25 KB gz. Pre-rendering bakes the page's full text into the HTML so crawlers
       that don't run JavaScript can read it; that text is the point, so it is capped per page rather than folded
       into the asset budget.
  Exit 1 when either budget is exceeded. Usage: node marketing/tools/size.js
*/
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const SITE = path.resolve(__dirname, "..", "site");
const ASSET_BUDGET = 120 * 1024, PAGE_BUDGET = 25 * 1024;
const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const row = (f, b, g) => console.log(f.padEnd(34) + String(b).padStart(8) + " raw " + String(g).padStart(7) + " gz");
let fail = false;

const assets = ["assets/app.css", "assets/js/content.js", "assets/js/core.js", "assets/js/analytics.js"]
  .concat(fs.readdirSync(path.join(SITE, "assets/js/sections")).filter((f) => f.endsWith(".js")).sort().map((f) => "assets/js/sections/" + f));
let sum = 0;
for (const f of assets) { const b = fs.readFileSync(path.join(SITE, f)); const g = gz(b); sum += g; row(f, b.length, g); }
console.log("-".repeat(58));
if (sum > ASSET_BUDGET) { console.error(`assets: FAIL — ${(sum / 1024).toFixed(1)} KB gz, over 120 KB by ${sum - ASSET_BUDGET} B`); fail = true; }
else console.log(`assets: OK — ${(sum / 1024).toFixed(1)} KB gz (${ASSET_BUDGET - sum} B under 120 KB)`);

const pages = [];
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const full = path.join(dir, n), rel = path.relative(SITE, full);
    if (fs.statSync(full).isDirectory()) { if (!rel.startsWith("assets")) walk(full); }
    else if (n.endsWith(".html")) pages.push(rel);
  }
})(SITE);
console.log("");
for (const f of pages.sort()) {
  const b = fs.readFileSync(path.join(SITE, f)); const g = gz(b); row(f, b.length, g);
  if (g > PAGE_BUDGET) { console.error(`page: FAIL — ${f} is ${g} B gz, over 25 KB`); fail = true; }
}
const worst = Math.max(...pages.map((f) => gz(fs.readFileSync(path.join(SITE, f)))));
console.log("-".repeat(58));
console.log(`pages: ${fail ? "see failures above" : "OK"} — largest ${(worst / 1024).toFixed(1)} KB gz · a first visit downloads one page + assets = ~${((sum + worst) / 1024).toFixed(0)} KB gz`);
process.exit(fail ? 1 : 0);
