#!/usr/bin/env node
'use strict';

/**
 * The challenge exam for the SHIFT sales bot (owner, 2026-10-08: «people try to challenge the bot — use
 * something really smart that rarely makes errors»).
 *
 *   ANTHROPIC_API_KEY=… node scripts/challenge-exam.js --cases scripts/eval/challenge/cases.json \
 *     --out /tmp/exam --label opus-low [--model claude-opus-5-5] [--effort low] [--only id1,id2]
 *
 * Every case is a real or adversarial customer conversation: the customer's messages are fixed, the bot is
 * the REAL pipeline (eval-shift's live mode: persistInbound → runBatch → processShiftBatch → validators →
 * deliverResult) answered by the real Claude model. Voice notes, photos and videos arrive with the
 * transcript the live media reader would have produced. Nothing reaches WhatsApp or the database.
 *
 * The run writes <out>/<label>.json: per case the transcript (what the customer sent, what the bot sent,
 * actions, stage, status), the deterministic gate failures, and latency/cost from the API's usage. Grading
 * against each case's must / must_not happens separately (a reviewer reads the transcripts).
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { cases: null, out: null, label: 'run', model: null, effort: null, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--cases') args.cases = next();
    else if (a === '--out') args.out = next();
    else if (a === '--label') args.label = next();
    else if (a === '--model') args.model = next();
    else if (a === '--effort') args.effort = next();
    else if (a === '--only') args.only = next().split(',').map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

/** A case → an eval-shift scenario: a weekday morning inside team hours, one inbound turn per case turn. */
function toScenario(c) {
  return {
    id: c.id,
    title: c.title,
    clock: '2026-10-12T11:00:00+03:00',
    profileName: c.profile_name || 'زبون',
    env: { SHIFT_MEDIA: '1' },
    turns: (c.turns || []).map((t, i) => ({
      at: i === 0 ? 0 : `+${Math.max(0.1, Number(t.gap_minutes) || 1)}m`,
      inbound: [
        ...(t.inbound || []).filter((s) => typeof s === 'string' && s.trim()),
        ...(t.media || []).map((m) => ({ media: m.type, transcript: m.transcript, caption: m.caption || '' })),
      ],
    })).filter((t) => t.inbound.length),
  };
}

function botText(part) {
  const lines = [part.text || ''];
  if (part.buttons && part.buttons.length) lines.push(`[أزرار: ${part.buttons.map((b) => b.title || b).join(' · ')}]`);
  if (part.rows && part.rows.length) lines.push(`[قائمة: ${part.rows.map((r) => r.title || r).join(' · ')}]`);
  return lines.filter(Boolean).join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cases || !args.out) {
    console.error('challenge-exam: --cases and --out are required');
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('challenge-exam: ANTHROPIC_API_KEY is required (the bot answers live)');
    process.exit(2);
  }
  if (args.model) process.env.ANTHROPIC_MODEL = args.model;
  if (args.effort) process.env.ANTHROPIC_EFFORT = args.effort;

  const evalShift = require('./eval-shift');
  evalShift.installHooks({ live: true, provider: 'anthropic' });
  const ROOT = path.join(__dirname, '..');
  // The media reader answers from each case's transcript instead of downloading from Meta.
  const media = require(path.join(ROOT, 'src/workflows/shift/media'));
  media.enrichBatch = async (business, token, batch, { now } = {}) => {
    const updates = [];
    const out = (batch || []).map((row) => {
      const t = row && row.media_id ? evalShift.state.mediaTranscripts[row.media_id] : null;
      if (!t) return row;
      const shiftMedia = { type: t.type, text: t.text, status: 'ok', at: (now || new Date()).toISOString(), ms: 1 };
      if (row.id) updates.push({ id: row.id, shift_media: shiftMedia });
      return { ...row, shift_media: shiftMedia };
    });
    return { batch: out, updates };
  };

  const cases = JSON.parse(fs.readFileSync(args.cases, 'utf8'));
  const list = (Array.isArray(cases) ? cases : cases.cases).filter((c) => !args.only || args.only.includes(c.id));
  fs.mkdirSync(args.out, { recursive: true });
  const results = [];
  const allCalls = [];
  for (const c of list) {
    const scenario = toScenario(c);
    const started = Date.now();
    let r = null;
    let error = null;
    try {
      r = await evalShift.runScenario(scenario, { mode: 'live', quiet: process.env.EXAM_VERBOSE !== '1' });
    } catch (err) {
      error = String(err && err.stack || err).slice(0, 600);
    }
    const calls = evalShift.state.modelCalls.slice();
    allCalls.push(...calls);
    const stats = evalShift.liveClaudeStats(calls);
    const turns = r ? r.transcript.turns.map((t) => ({
      customer: t.inbound.map((m) => (m.type === 'text' ? m.text : `[${m.type}]${m.text ? ` ${m.text}` : ''}`)),
      media: (c.turns[t.index] && c.turns[t.index].media) || [],
      bot: t.outbound.filter((p) => !p.staff).map(botText),
      actions: (t.results || []).filter(Boolean).map((x) => `${x.kind}:${x.action}`),
      stage: t.stageAfter,
      status: t.statusAfter,
      ai_calls: t.aiCalls,
    })) : [];
    results.push({
      id: c.id,
      category: c.category,
      title: c.title,
      source: c.source,
      must: c.must,
      must_not: c.must_not,
      why: c.why,
      turns,
      final: r ? { status: r.transcript.final.conversation && r.transcript.final.conversation.status, stage: r.transcript.final.conversation && r.transcript.final.conversation.current_state, alerts: r.transcript.final.alerts } : null,
      gate_failures: r ? r.gateFailures.map((f) => `${f.gate} turn ${f.turn === null ? '-' : f.turn + 1}: ${f.detail}`) : [],
      error,
      latency_ms: { p50: stats.p50, p90: stats.p90, max: stats.max },
      cost_usd: stats.costTotal,
      wall_ms: Date.now() - started,
    });
    console.log(`${args.label} ${results.length}/${list.length} ${c.id} ${error ? 'ERROR' : 'ok'} ${(stats.costTotal || 0).toFixed(3)}$ p50=${Math.round(stats.p50 || 0)}ms`);
    fs.writeFileSync(path.join(args.out, `${args.label}.json`), JSON.stringify({ label: args.label, model: process.env.ANTHROPIC_MODEL || null, effort: process.env.ANTHROPIC_EFFORT || null, results }, null, 1));
  }
  const total = evalShift.liveClaudeStats(allCalls);
  const summary = { label: args.label, model: process.env.ANTHROPIC_MODEL || null, effort: process.env.ANTHROPIC_EFFORT || null, cases: results.length, errors: results.filter((r) => r.error).length, calls: total.calls, failed_calls: total.failed, p50: total.p50, p90: total.p90, max: total.max, cost_usd: total.costTotal, stops: total.stops };
  fs.writeFileSync(path.join(args.out, `${args.label}.json`), JSON.stringify({ ...summary, results }, null, 1));
  console.log(JSON.stringify(summary));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
