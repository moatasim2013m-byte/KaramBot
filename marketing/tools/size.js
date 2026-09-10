#!/usr/bin/env node
/*
  size.js — weight-budget gate for shifts-ai.store (DESIGN-CONTRACT.md: html+css+js gzipped ≤ 120 KB).
  Dependency-free. Measures every shipped file (index.html, assets/app.css, assets/js/**.js) gzipped
  at level 9 — the per-file sum is what a static host actually transfers — and prints the
  whole-page concatenated gzip for reference. Exit 1 when the per-file sum exceeds the budget.
  Usage: node marketing/tools/size.js
*/
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const SITE = path.resolve(__dirname, "..", "site");
const BUDGET = 120 * 1024;
const files = ["index.html", "assets/app.css", "assets/js/content.js", "assets/js/core.js", "assets/js/analytics.js"]
  .concat(fs.readdirSync(path.join(SITE, "assets/js/sections")).filter((f) => f.endsWith(".js")).sort().map((f) => "assets/js/sections/" + f));
let sum = 0, raw = 0; const bufs = [];
for (const f of files) {
  const b = fs.readFileSync(path.join(SITE, f)); bufs.push(b);
  const g = zlib.gzipSync(b, { level: 9 }).length; sum += g; raw += b.length;
  console.log(f.padEnd(34) + String(b.length).padStart(8) + " raw " + String(g).padStart(7) + " gz");
}
const whole = zlib.gzipSync(Buffer.concat(bufs), { level: 9 }).length;
console.log("-".repeat(58));
console.log("per-file gzip sum: " + sum + " B (" + (sum / 1024).toFixed(1) + " KB) · whole-page single gzip: " + whole + " B (" + (whole / 1024).toFixed(1) + " KB) · raw " + (raw / 1024).toFixed(1) + " KB");
if (sum > BUDGET) { console.error("size: FAIL — over the 120 KB budget by " + (sum - BUDGET) + " B"); process.exit(1); }
console.log("size: OK — " + (BUDGET - sum) + " B under budget");
