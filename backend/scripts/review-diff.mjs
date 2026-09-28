#!/usr/bin/env node
/**
 * Have an outside model review a diff.
 *
 * Not a substitute for running the tests — a model cannot execute anything. It is the review
 * gate the test suite never was: a second reader looking for the defect that passes every test.
 * Useful on its own, and necessary while GitHub Actions is unavailable.
 *
 *   git show HEAD > /tmp/d.txt
 *   node scripts/review-diff.mjs openai/gpt-6-astra /tmp/d.txt [instructions-file]
 *
 * Reads OPENROUTER_API_KEY. Reasoning models return their answer in `reasoning` with `content`
 * null, so both are read.
 */
import fs from 'fs';

const [model, diffFile, instructionsFile] = process.argv.slice(2);
if (!model || !diffFile) {
  console.error('usage: review-diff.mjs <openrouter-model> <diff-file> [instructions-file]');
  process.exit(2);
}

const DEFAULT_INSTRUCTIONS = `Review this diff for real defects.

Look for, in priority order:
- Correctness bugs that would show a wrong state to a user or take a wrong action.
- Tenant isolation: a business must be derived from the URL or the session, never the request body.
- States that are unknown being rendered or treated as healthy.
- Error paths that leak a token or a secret into a log, a message or a response.
- Anything that would crash on a null or absent field.
- Migrations that are unsafe on a live table.

Be concrete: name the file and line, say what input or sequence triggers it, and give the
smallest correct fix. If a guard elsewhere already prevents something, say so instead of
reporting it. An empty finding list is a valid answer — do not invent issues to seem useful.`;

const instructions = instructionsFile ? fs.readFileSync(instructionsFile, 'utf8') : DEFAULT_INSTRUCTIONS;
const prompt = `${instructions}\n\nDIFF\n${fs.readFileSync(diffFile, 'utf8')}`;

const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 14000 }),
});
const j = await r.json();
if (!r.ok || j.error) {
  console.error('ERROR', JSON.stringify(j.error || j).slice(0, 400));
  process.exit(1);
}
const m = j.choices?.[0]?.message || {};
process.stdout.write(m.content || m.reasoning || '(empty response)');
