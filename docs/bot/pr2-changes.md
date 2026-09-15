# PR2 — SHIFT bot sales quality: what changed and how to roll it out

Branch `feat/shift-bot-pr2-sales`, stacked on PR1 (`feat/shift-bot-pr1-reliability`). It follows
`implementation-decisions-2026-09-14.md` (D1–D27) and `pr2-contracts.md`; the contract's §14 lists the deliberate
departures from the plan, the design and the prompt doc. Commands for Cloud Run and the database are in
`backend/scripts/shift-runbook.md` (§7 PR2 flags, §8 rollback order). The owner runs them, not Claude.

PR2 adds no Prisma migration, no new API route and no new required env var. Restaurant, clinic, generic and
external-mode tenants are unchanged. Every customer link still comes from `config/site.js` (`https://shifts-ai.com`,
D4), and every outbound message, sample images, lists, CTA links and nudges included, is a PR1 send intent with its
row id as `biz_opaque_callback_data` (D17) and goes through the pre-send fence check (D20/D21).

## What changed

**Prompt v2 (D2).** `prompt.ar.js` builds a static system prompt per sector (identity and honesty rules, the nine
actions, the JSON contract, sector-trimmed knowledge and the operational FAQ). `context.js` builds the dynamic user
turn: the curated lead card, the missing fields, team hours, the session clock, the stage objective from
`objectives.js`, role-tagged history (moved out of the system prompt), the allowed buttons and, when a role-play is
running, its fenced facts. Customer text is JSON-fenced and header-like lines are stripped, so a profile name such as
«# سياق الجلسة» cannot pose as an instruction. `actions.js` adds `SEND_SAMPLE`, `START_ROLEPLAY`, `END_ROLEPLAY`, the
stages `sample` / `roleplay_setup` and `next_step`; `actionSetFor()` returns the PR1 set under `SHIFT_PROMPT_V1=1`.

**Validators before every model line (`validators.js`).** Server acks are never checked (they are audited by unit
tests); only the model's own words are:
- digits near price, discount, subscription or timeline words, unless the customer, the site calculator, the
  role-play facts or their arithmetic closure gave the number **and** the sentence attributes it («ميزانيتك»,
  «الحاسبة», «حسب أسعارك»…); clock times and durations are exempt;
- guarantee and over-claim phrases, affirmative claimed actions outside role-play («سجّلت», «حجزت»…), human claims,
  and a dodged «إنت بوت؟» (the honest identity line replaces it);
- language mirroring, with an Arabizi detector (Arabizi in → Arabic script out, `lead.language='ar'`);
- Markdown, links other than the allowed `shifts-ai.com` pages, at most one question (the name + business ask and
  the role-play setup ask are the two exceptions), button allow-listing and titles, slot injection when the customer
  asks for a time, a dangling «:», and a length split into at most 3 parts.

A blocked reply is regenerated once with a hint when at least 4 s of the 18 s deadline remain. If it is blocked
again, or there is no time, only the model's line is replaced by a fixed stage line: the state, acks, team request
and alert of the result are kept (never silent, G4). Blocks are logged in `workflow_data.validator_blocks` (last 20).

**Site pre-fill (`prefill.js`).** The message the site composes («مرحبًا شِفت 👋 عندي …» / "Hi SHIFT 👋 I run …") is
parsed on the first message only: business name, sector, sector text, products, needs, name, attribution and the
calculator estimates. Calculator numbers and the phone line are kept out of `customer_numbers`; the estimates are
stored in `workflow_data.site_estimates`. A bundle quote from the site is flagged to the team even if the model forgets.

**Buttons, lists, images and CTA links (`whatsapp.js`, `assets.js`, `buttons.js`).** `whatsapp.sendStructured` sends
image-header buttons, lists, CTA URLs and images with exact Graph payloads and limits. New deterministic taps (no AI):
the sector list, `sample_roleplay:*`, `sample_page:*`, `sample_image:*`, `send_sample_now`, `quote_written`,
`lead_call`, `end_roleplay`, `roleplay_continue`, `followup_yes` / `followup_no` and `nudge_not_now`.
`SEND_SAMPLE` sends a sector image card only for a vetted sector (D11); otherwise it starts the role-play setup, or
sends the sector page when role-play is off. A rejected image header falls back once to the same buttons without the
header (a new `:fb` intent row). `assertButtons()` walks every PR2 title at boot.

**Role-play sandbox (`roleplay.js`).** «جرّبني», a `sample_roleplay` tap or a customer-role question asks for the
business name and a few facts (fixed ask per sector). `START_ROLEPLAY` opens with «مثال توضيحي 🎭 … ما في حجز ولا طلب
حقيقي هون», answers in character for at most 6 turns from the given facts only, and ends on «خلص», `END_ROLEPLAY`, the
turn cap, a handoff, an opt-out or 15 minutes idle (silently, by the sweeper). Lead extraction is off inside the
sandbox; the only lead write is `business_name` from the setup (`_prov.source='roleplay_setup'`). No buttons inside
the example, and the sandbox never loads order or appointment code.

**The single nudge (`followups.js`, sweeper step `nudges`).** After a bot message that asked something, one nudge per
silence (at most two per conversation) is planned 20 h later, moved into friendly Amman hours (09:00–21:30, never
Friday 11:00–14:00), and dropped with a staff call task if it would land within 30 minutes of the 24 h window closing.
It is claimed before the send, so two sweeps cannot both deliver it. Opt-out, «مش هلأ», a staff message or any new
inbound cancels it. No nudge text mentions the window or what WhatsApp allows.

**Media (`media.js`, `SHIFT_MEDIA=1` only).** Up to two voice notes or images per batch are transcribed/read with
Gemini inside an 8 s budget and join the batch as text. Default off: PR1's placeholder and «بقرأ النص بس» ack apply.

**Consent and staff tasks.** `followup_yes` stores consent `{text, answer, at, msg_id, scope:{channel:'whatsapp',
when:'+2d', max:1}}` in `workflow_data.lead_consent` and adds a `followup_consent` staff task; no bot send is
scheduled (templates beyond 24 h are v1.1).

**Sweeper.** Two steps are appended: `roleplay_idle` and `nudges`. `/api/internal/shift-status` adds
`nudges_pending` and `roleplays_active`.

**Inbox (SHIFT business only).** «مثال جاري» chip, 🔥 for score ≥ 6 and a «🔥 عملاء ساخنين» client-side filter,
«نسخة من الموقع» for pre-filled conversations, lead-card rows for needs, budget, consent, objections, source,
calculator estimates and open staff tasks (read-only), and a «صورة» / «أزرار» tag on structured outbound messages.

**Offline eval (`scripts/eval-shift.js`, `tests/shiftEvalGates.test.js`).** The 15 eval conversations (15 split into
a–e) replay through the real pipeline with scripted model replies and gates G1–G14 written from the eval doc. All
pass; the Jest suite runs them in `npm test` with no network.

### Integration pass (this hand-off)

Cross-slice mismatches and eval findings fixed in code, with tests:
- **A declined call no longer gets slot buttons.** «ما بدي مكالمة» matched the time-request pattern («بدي مكالمة»), so
  a written-quote reply got «أقرب أوقات الفريق:» and slots pushed after it (eval #11). Negated asks are excluded.
- **A stated time is stored at once.** "Can we speak tomorrow after 4?" with only `lead.preferred_time` from the model
  now stores the time, sets `capture_pending` and asks name + business with the purpose line, instead of offering
  slots over the time the customer already gave (eval #7). With the name known it is the capture itself. Only a value
  that reads like a time (digit, day, part of day) is upgraded.
- **Capture ack printed twice.** When the details arrived without a question after a capture ask, the batcher
  re-rendered the ack with the ack itself as the "model line". Fixed in `index.js#syncCapture`.
- **«جرّبني» always gets the fixed setup ask.** A model-proposed `roleplay_setup` now appends the same per-sector
  ask the tap sends (the model's own questions are dropped), so the example never depends on the model (eval #14).
- **Consent buttons.** The model's [أكيد][لا] under «بتحب يتواصل معك الفريق بعد يومين؟» were stripped. They are
  allowed (server titles) after a declined call: twice, or once with a written quote open (eval #11).
- **Role-play totals.** The arithmetic closure took quantities from the current batch only, so «أكّد» repeating
  «المجموع 10 دنانير حسب أسعارك» from two turns back was blocked and replaced by an odd fallback. Quantities now come
  from every customer message since the example started (eval #5).
- **Tier-2 handoff line checked.** A model-initiated handoff skipped the validators, so an invented price in its
  first line would have been sent. It now gets one content pass; a blocked line becomes the fixed «ولا يهمك.».
- **Calculator echo after a slot tap.** `objectives.js` read the tapped id from `last_bot.action`, while `buttons.js`
  writes it to `last_bot.button_id`; it now reads both.
- **Flaky test.** `shiftButtons.test.js` mocked the existing `followups.js` as a *virtual* module, which parallel
  full runs did not always apply. The mock is now a normal one.
- `eval-shift.js` creates `EVAL_SCRATCH_DIR` when it does not exist.
- The eval scenarios that had been relaxed for these bugs (5, 7, 11, 14) assert the eval doc's behaviour again.

`tests/shiftE2E.test.js` gains 10 PR2 cases through the real app (signed webhook → persist → batcher → workflow →
Graph mock): the site pre-fill, «جرّبني» → setup → facts → a closure total → «خلص» with no order, a vetted image card
through its own intent row, the unvetted fallback to the setup ask, an invented «50 دينار» regenerated then replaced,
«are you a bot?», an Arabizi opener, an English customer with the `/en` page, `SHIFT_PROMPT_V1=1`, and one nudge from
the sweeper at a friendly hour inside the window.

Verification: full backend suite 40 suites / 1 257 tests green (1 pre-existing skip), all 15 eval scenarios pass
(`node scripts/eval-shift.js` exits 0), the app loads with `NODE_ENV=test`, the frontend builds, and no backend
file contains the old domain.

### Review round 1

Confirmed findings fixed, each with a permanent test (the `_verify_pr2_*` files are gone):
- **Regenerated handoff validated.** Attempt B returning `HANDOFF_TO_HUMAN` skipped every check, so a price, a
  claimed action or «لا مش بوت، معك سامر» reached the customer. It now goes through the same handoff content pass
  as attempt A, and both attempts' `validator_blocks` entries are kept.
- **Role-play debrief out of character.** The END_ROLEPLAY / handoff / «مش هلأ» / opt-out line is checked with
  `roleplayActive` false (claimed-action guard on, no closure numbers); a blocked debrief falls back to the fixed end
  line alone. Only the in-character turn-cap line keeps the role-play allowances.
- **Validators widened beyond §5.3–§5.7** (the contract lists were the gap): Jordanian teens, compound hundreds,
  «ألفين», dual nouns and «بالمية» as number evidence; cost/fee/currency/percent/free/trial/duration and
  approximation keywords; business-statistics keywords outside the example; a digit counts in its clause up to
  48 characters from a keyword; «الساعة N» / "at N" is a clock time only for N ≤ 24; the +2 d consent delay
  («بعد يومين» with «يتواصل») is allowed. Identity questions («انت حقيقي؟», «هل الرد آلي؟», "is this automated?"),
  bare denials («لا، مش بوت»), "not an AI", made-up staff personas and negated disclosures. Claimed actions
  («أبلغت», «تم تسجيل», «ثبّتت», «حطيت اسمك», «أرسلتلك», "You're booked"), with «بلغتهم» / «بسجل واضح» no longer
  false positives. Client and market claims («أغلب زبائننا», «عملاءنا», «كثير مطاعم», «رح يرفع مبيعاتك», "many
  restaurants"); «زباينا» is allowed inside the example.
- **Delivered facts.** State is still written before the send (D17), but a rerun no longer trusts
  `samples_sent.image/page`, `disclosed_at` or a just-started example when the intent that carried it failed and none
  that carried it may have arrived (`replyBatcher.deliveredView`, in memory only). A failed card is sent again instead
  of «المثال وصلك فوق 👆»; a failed start line leads the first in-character reply.
- **Pre-fill parsing bounded.** `isPrefill` is false above 1 000 code points (the composer caps at 700 + «…») and the
  builder-plan groups no longer overlap; a 20k-character «Hi SHIFT…» returns in well under 50 ms.

Minors fixed: setup ask not repeated on fallback; one question with a vetted card or the setup ask; sandbox
CAPTURE_TIME / meeting flag → NONE; example business name stripped of links, prices and offers; two questions
with «؟» followed by an emoji or letter trimmed; unlisted-TLD links removed and no dangling colon after a removed
link; interactive bodies kept ≤ 1024 with a text fallback on injected slot buttons; any transcribed voice note
takes the model path (`SHIFT_MEDIA=1`); a short English tap («No») with no stored language gets English; the
commitment push restarts its count after a reply that offered a step; `sample_touch` not after the page link; close
and objection stages nudge with the close line ([مكالمة][مش هلأ]) instead of another example; no nudge while an
example is live, the idle end clears an unsent nudge, the resume nudge is due 2 h after the silence and its
[نكمّل] resumes the stored facts; offline `eval-shift.js` forces the Gemini fake and refuses network SDKs.

Not changed: the nudge honorific stays «أستاذ {name}، » as §8.3 and eval #10 specify (the gender concern is an owner
decision); the header-less card fallback still runs only on a synchronous Graph refusal, not on a later `failed`
status (131053); customer-derived values in the history and objective lines are not yet fenced. The branch must be
rebased onto PR1's final `e2a36c90` before merge.

### Review round 2

Confirmed findings fixed, each with a permanent test (the `_verify_pr2_r2_*` files are gone):
- **Silent idle end (G6).** The first batch after the sweeper ended an example for idleness (within 24 h, not yet
  told) is still sandbox for the lead: an in-character «اسمي أبو أحمد، بكرا الساعة 8» is no lead, no capture and no
  alert. That reply starts with the end line's statements, the user turn says the example ended, and
  `roleplay.end_announced_at` records it (withdrawn by `deliveredView` when the reply never arrived).
- **Grounded role-play facts.** START_ROLEPLAY keeps only fact numbers the customer typed (batch, transcripts,
  history): «منسف 8 دنانير» with no price typed becomes «منسف», so the digit guard blocks the invented price in
  character. The example's name reaches the real lead only when the customer wrote it.
- **Validators widened again:** identity questions ("are u a bot?", «انت بشر؟», a bare «بوت؟», "is this AI?") and
  denials («لا، إنسان حقيقي», «أنا بشر», "real human here", "a real member of the team"); plural, passive and
  scheduling claims («سجلنا», «رفعت طلبك», «تم تأكيد», «موعدك مثبت», «رح يكلمك بكرا الساعة 4», "Your call is set
  for", "I've arranged"); multipliers, «من كل», seconds, «مئات المطاعم», «الأغلبية», «كثير من أصحاب», and setup
  durations («التفعيل بياخد 48 ساعة» is no longer a time). A customer's guessed price is never affirmed through
  the attribution or quote exemptions («أي، رقمك 50 دينار بيغطي الاشتراك»), and the digits hint says so. An
  either/or question split over two marks is joined instead of trimmed to its «ولا…؟» tail.
- **Async image failure.** A card or image Graph accepted and then failed to fetch (a later `failed` status, e.g.
  131053) gets its header-less fallback from `failIntent`, stored on the intent as `fallback_part`.
- **No nudge while the customer waits on the team** (pending with an open request, or the newest inbound
  `awaiting_staff`/`unconfirmed`).
- **Sector text** is inserted literally (`$&`, `` $` `` no longer expand past 1024) and only its first phrase, with no
  link, number or promise, reaches the card.
- **Taps end a live example** (slot, «احكي مع الفريق», «مش هلأ», sector, quote…); a live object outside the example's
  stage is never played and is ended by results and by the sweeper, which now ends the object before moving the stage.

Minors fixed: a line left dangling by a removed link regenerates; D9 call length in minutes is blocked; the link
filter matches `shifts-ai.com.<host>` whole, more country/new TLDs and IPv4 hosts; the nudge passes `optedOutSince`
to the pre-send check and is planned from `deliveredView` (so `sample_touch` can fire); a delayed follow-up is not
sent after the part it hangs on failed; a re-run of the first reply to a site message keeps its pre-fill; the
SHIFT_ROLEPLAY=0 «خلص» exit raises no unanswered alert; U+2028/U+2029 are escaped in fences and split header lines;
sector text and nudge values drop links and promises; consent buttons use the post-transition stage; with role-play
off the stage nudge's first button opens the sector page.

Not changed: customer-derived values in server outbound rows are still rendered as «كرم:» history lines (their
link/promise content is now filtered at the source).

### Review log — final gate (2026-09-15)

No source was edited in this pass; every check below was green on the working tree as it stands.

| Check | Result |
|---|---|
| `_verify_*` files | none left (the 12 `_verify_pr2_r2_*` files are deleted) |
| Full backend suite (`npx jest --forceExit`) | 40 / 40 suites, 1 470 passed, 1 skipped (pre-existing `auth.test.js` DB test) |
| `tests/shiftEvalGates.test.js` | 47 / 47 passed |
| `node scripts/eval-shift.js` (offline replay) | exit 0, 19 scenario lines PASS, 0 FAIL |
| App under `NODE_ENV=test` | `src/app.js` and every PR2 module load; `GET /health` → 200 `ok` (supertest, no listen) |
| Frontend `vite build` (out of tree) | 1 429 modules, built |
| Literal old domain in `backend/` (excluding `node_modules`) | 0 files |
| Restaurant / clinic / routes / `src/ai` / `marketing/` | no diff against PR1 |
| Rebase dry-run | PR1's final commit `e2a36c90` (on top of this branch's base `013acb08`) applies cleanly to a copy of this tree; the suite there: 40 passed + 1 skipped (`integration/pg.test.js`, needs Postgres), 1 474 passed, 35 skipped |

Residual risks:
- **Not rebased yet.** The branch base is `013acb08`, not the final PR1 `e2a36c90`. The dry-run shows no textual
  conflict and a green suite, but the real rebase must still be done and re-run.
- **PR2's Prisma queries are not verified on real Postgres.** PR2 adds no raw SQL (it calls PR1's `jsonb.*` helpers,
  which PR1 verified behind PgBouncer), but the sweeper's `findMany` / `updateMany` filters and the batcher's intent
  rows have only run against `fakeDb`. Run `scripts/pg-integration.sh` after the rebase.
- **WIP history.** The review-round-2 fixes sit in `wip(bot): PR2 checkpoint` commits (latest `5f4f2508`, the tree
  checked here); squash into reviewable commits before opening the PR.
- **Owner approvals open:** 7 `OWNER-APPROVAL-PENDING` markers (`acks.js`, `assets.js`, `context.js`, `followups.js`,
  `objectives.js`, `prompt.ar.js` ×2) and the Inbox labels; no native Jordanian review pass yet.
- **Replay only.** `eval-shift.js --live` (real Gemini) has never run, so gates are proven against scripted model
  replies, not the model's actual phrasing; week-1 Inbox review stays mandatory.
- The known gaps listed at the end of this file are unchanged.

### Rebase on main (#23) and the call-time honesty fix (2026-09-15)

Rebased onto `main` with hotfix #23. `index.js` keeps PR2's validator loop with the hotfix deadline
(`SHIFT_AI_DEADLINE_MS`, default 25 s); `aiFailureResult` keeps both conditions: no slot buttons inside the
role-play sandbox (PR2), and only when `bot_turns > 0` with no `lead.preferred_time` / `capture_pending` (#23).
The eval replay now expects the #23 wording «تأخر ردّي شوي».

Owner phone test on the PR1 bot: «صح عليكم طيب يلا» (agreeing to a call, no time) came back as CAPTURE_TIME with a
slot title as `time_text`; the server sent the model's «اختار الوقت المناسب إلك… أقرب أوقات الفريق:» and then
«سجّلت طلب مكالمة: بيكابو، بكرا 10–12…», with no buttons. The same path existed in PR2 (`results.js` CAPTURE_TIME,
the `lead.preferred_time` upgrade, a meeting flag, a pending capture, and the base lead patch all took the model's
time as the customer's). Now:

- A call time is stored or acked only when the customer tapped a slot, or when the customer's own text in the
  batch (typed or a transcript) carries an explicit day/time (`customerCallTime`). A model time the customer's words
  only partly back («بكرا» → «بكرا 10–12») gives way to the customer's words; one they do not back is dropped.
  A pending `time_text` must be in the customer's words in the batch or the loaded history.
- Agreeing to a call without a time → the slot buttons under «أقرب أوقات الفريق:» (server offers), or
  «أي يوم ووقت بناسبك؟» when none can be offered. Nothing stored, no capture, no alert.
- The capture ack never follows a model sentence asking the customer to choose a time (`renderCaptureAck`, so the
  batcher's re-render too).
- Tests: `tests/shiftCaptureHonesty.test.js` (AR and EN), two e2e cases in `tests/shiftE2E.test.js`. Four PR1/PR2
  tests that fed a time only through the model's `time_text` now put it in the customer's text.

## Environment flags

All optional, read at call time (an env change applies on the next revision), nothing added to
`REQUIRED_IN_PRODUCTION`. PR1's flags (`SHIFT_BOT_LIVE`, `SHIFT_TEST_NUMBERS`, `SHIFT_SITE_URL`, …) are unchanged.

| Variable | Default | Effect |
|---|---|---|
| `SHIFT_PROMPT_V1` | unset → prompt v2 | `1` → PR1 prompt, action list and schema; also turns role-play off. Validators, buttons, pre-fill and nudges still run. |
| `SHIFT_ROLEPLAY` | unset → on | `0` → no example; role-play taps get the sector page; running examples end silently on the next sweep. |
| `SHIFT_NUDGES` | unset → on | `0` → no nudge is planned or sent. |
| `SHIFT_MEDIA` | unset → off | `1` → voice notes and images are transcribed/read. Needs the privacy-page media sentence first. |
| `SHIFT_SAMPLES_VETTED` | empty | comma-separated sectors whose image card may be sent, unioned with `ai_config.samples_vetted`. |
| `SHIFT_SAMPLES_BASE` | `${SITE_URL}/assets/samples` | base URL of `{clinic,restaurant,store,other}-square-v1.png`. |

New `ai_config` key read (never written by code): `samples_vetted` (string array). Vet with the key-preserving
`jsonb_set … ||` statement in runbook §7, never a full `ai_config` rewrite.

Deploy defaults: prompt v2 live, role-play on, nudges on, media off, no sector vetted, so `SEND_SAMPLE` uses the
role-play setup until the owner vets a sector whose PNG is live.

## Rollout: deploy → phone checklist → go-live

The bot is live for every sender today (D1) and merging to `main` deploys. Ads have not started.

**Before merging**
1. PR1 must be merged and live first. This branch was built on PR1 at `013acb08`; the PR1 branch has since moved
   (`e2a36c90`, the Postgres/PgBouncer fixes), so rebase PR2 on the final PR1 and re-run the backend suite.
2. Owner approvals still open (all marked `OWNER-APPROVAL-PENDING` in code): the Arabic in `prompt.ar.js` (including
   `OPERATIONAL_FAQ`), `acks.js`, `assets.js` (the clinic, store and other page bodies), `followups.js`,
   `objectives.js`, and the Inbox labels; a native Jordanian review pass. Check that the live restaurants page really
   lets a visitor change the restaurant's name before keeping that sentence.
3. Go out save-only: `SHIFT_BOT_LIVE=0` and `SHIFT_TEST_NUMBERS=962796381676` (runbook §2). Everyone's messages are
   saved; only the test number is answered.

**Deploy**
4. Merge. Confirm the new revision started (`assertButtons()` runs at boot and a bad title crashes the start).
5. `/api/internal/shift-status`: `received_backlog: 0`, `sweep.at` recent, `nudges_pending` and `roleplays_active`
   present.

**Phone checklist (test number 962796381676; press «إرجاع للبوت» first if the conversation is claimed)**
- [ ] «مرحبا» from a fresh state → one reply with the intro («مساعد شِفت الذكي», `shifts-ai.com`) and the 4-row
      sector list. Tap [عيادة] → the fixed discovery question, no delay.
- [ ] From the site's WhatsApp button on the restaurants page, send the composed message → one reply that mirrors the business
      and needs, no calculator numbers, slot buttons; the lead card shows the parsed fields and «نسخة من الموقع».
- [ ] «كم السعر؟» → no number, the written-quote offer, one question. «بس أعطيني رقم تقريبي» → the quote ack, the
      Inbox shows «يحتاج الفريق».
- [ ] «إنت بوت؟» → «أي، أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي)…».
- [ ] «جرّبني» → the setup ask. Send «مطعم تجربة، شاورما 3 دنانير، برجر 4» → «مثال توضيحي 🎭…», the Inbox shows
      «مثال جاري». «بدي 2 شاورما و1 برجر» → a total «حسب أسعارك», no buttons. «خلص» → the debrief question, no
      order anywhere, `lead.name` unchanged.
- [ ] «أوريني مثال» on an unvetted sector → the setup ask (no image). After vetting one sector with a live PNG,
      the same request → one image card with 3 buttons; tap «افتح صفحة …» → the CTA opens the `shifts-ai.com` page.
- [ ] Write in English ("I run a clinic, how does it work?") → English reply, English buttons, `/en/…` links.
- [ ] Write Arabizi («mar7aba, shu btsawo?») → Arabic-script reply.
- [ ] «ما بدي مكالمة» after a call offer → no slot buttons.
- [ ] Nudge (optional, needs 20 h): leave a question unanswered → one nudge the next day between 09:00 and 21:30,
      never two; «إيقاف» afterwards → no more nudges.
- [ ] `shift-status` again: `received_backlog: 0`, `unconfirmed: 0`, `ambiguous: 0`; the conversation's
      `workflow_data.validator_blocks` shows only expected codes.

**Go-live**
6. Remove `SHIFT_BOT_LIVE` (runbook §2). Watch the first real conversations in the Inbox; review every handoff,
   pricing turn, opt-out, `awaiting_staff` row and validator block in week 1 (eval doc).
7. Later, per owner decision: vet sample sectors (`samples_vetted`), then `SHIFT_MEDIA=1` after the privacy page
   carries the media sentence.

## Rollback (no deploy needed for 1–4; stop at the first step that fixes it)

1. **One PR2 feature:** `SHIFT_NUDGES=0`, `SHIFT_ROLEPLAY=0`, `SHIFT_MEDIA=0` (or unset), or un-vet a sample sector.
2. **PR1 prompt and action set:** `SHIFT_PROMPT_V1=1` (validators, buttons and pre-fill keep running).
3. **Save-only:** `SHIFT_BOT_LIVE=0` (test numbers still answered).
4. **Forward-only:** `ai_config.reply_mode = "external"`.
5. **Code:** `git revert` the PR2 merge commit. No migration to undo; the PR2 keys in `workflow_data`
   (`roleplay`, `nudge`, `samples_sent`, `site_estimates`, `lead_consent`, `staff_tasks`, `validator_blocks`, …) are
   ignored by PR1 code. Not verified: how PR1 answers a conversation left in a PR2 stage (`sample`,
   `roleplay_setup`, `roleplay`); check one after a revert.

## Known gaps and owner decisions

- The +2 lead score for a completed role-play is not applied: PR1 `computeScore` has no hook and `lead.js` is frozen.
- Inbox staff tasks are read-only; a «تم» button needs a route that can set `staff_tasks[i].done_at`.
- The sweeper creates a `window_closed` staff task only when a planned nudge cannot go out before the window closes.
  A conversation whose nudge was sent and whose window then closed gets the Inbox «النافذة مسكّرة — اتصل» flag but no
  task (eval #10's "staff call task" line is not asserted).
- The lead schema takes one `objection` per model turn, so eval #6's four objection keys need four objection turns;
  the replay asserts `staff` and `references`.
- The capture ack prints the customer's words («tomorrow after 4») rather than a resolved date and weekday.
- The v2 retry resends the same user turn (the provider has no retry user-turn option; `provider.js` is frozen).
- `processShiftMessage` keeps PR1's history query (no `created_at`), so its re-intro relies on `last_bot.at`.
- PR1-shaped parts (plain text, header-less buttons) still go through PR1's senders with identical payloads; three
  suites not owned by PR2 mock `whatsapp` without `sendStructured`.
- `--live` eval mode (real Gemini) has not been run; only replay.
