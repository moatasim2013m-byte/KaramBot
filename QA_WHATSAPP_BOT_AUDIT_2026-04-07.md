# WhatsApp Bot QA Audit (Post AI-Fallback Claim)

Date: 2026-04-07
Auditor mode: Senior production QA (code + static behavior validation)
Scope: `backend/node-app` WhatsApp inbound + auto-reply logic

## Verdict by requested checks

1. **Fixed FAQ still wins over AI** — ❌ **Not implemented**
   - Current bot logic only does keyword FAQ map + static fallback text.
   - No Gemini/AI path exists in `maybeAutoReply`, so there is no AI arbitration layer.

2. **Non-standard in-scope messages go to Gemini** — ❌ **Not implemented**
   - Unmatched text always uses configured `fallbackReply`; no Gemini call is attempted.

3. **Outside-scope messages do not get freeform answers** — ✅ **Pass (safe by omission)**
   - Outside scope does not trigger AI; only static fallback is sent.

4. **Complaints escalate safely** — ❌ **Not implemented**
   - No complaint intent detection, escalation routing, or ticket/handoff signal in auto-reply flow.

5. **Cooldown still works** — ✅ **Pass**
   - Bot checks recent auto replies by sender and cooldown window before sending.

6. **Recent staff reply still blocks auto-reply** — ✅ **Pass**
   - Bot skips auto-reply if a non-auto outbound staff reply exists in the last 10 minutes.

7. **Duplicate trigger protection still works** — ✅ **Pass**
   - Trigger dedupe marker (`auto_trigger_<incoming_message_id>`) is checked before processing, and persisted after processing.

8. **Missing GEMINI config fails safely** — ⚠️ **Partial / N/A in current code path**
   - There is no Gemini branch inside WhatsApp auto-reply to validate here.
   - Separate AI route (`/api/ai-copy/invite`) does fail safely with `503` if `GEMINI_API_KEY` is missing.

9. **Message persistence still works** — ✅ **Pass**
   - Inbound messages are persisted atomically with duplicate protection.
   - Auto-reply outbound message is persisted with `raw_payload.auto_reply: true`.

10. **AI replies are logged distinctly** — ❌ **Not implemented**
   - No AI reply flow exists; logging currently only covers generic auto-reply events.

## Exact remaining gaps

1. **No Gemini integration in WhatsApp auto-reply path**
   - Missing model invocation step for non-standard in-scope questions.
2. **No in-scope/out-of-scope classifier**
   - Current behavior is keyword match else fallback text only.
3. **No complaint safety policy in automation layer**
   - No complaint lexicon/classifier, no escalation queue signal, no explicit safe response branch.
4. **No AI-specific observability fields**
   - Missing `response_source` (`faq|ai|fallback|escalation`) and missing AI metadata logs.
5. **No WhatsApp-path GEMINI config guardrails**
   - Missing explicit branch handling for missing/invalid Gemini config in the bot flow itself.

## Minimal next fixes only

1. Add `resolveReplySource()` inside `maybeAutoReply` with strict priority:
   - `faq_match` → always return FAQ response first.
   - `complaint_detected` → escalate template/no freeform.
   - `in_scope_nonstandard` + Gemini configured → Gemini constrained answer.
   - else static fallback.
2. Add hard guard:
   - if Gemini branch selected and `GEMINI_API_KEY` missing/unhealthy → return **safe fallback** (not freeform).
3. Persist and log source explicitly:
   - Save `raw_payload.reply_source` + `raw_payload.ai_used` + optional `raw_payload.ai_model`.
   - Emit distinct log events like `AUTO_REPLY_AI_SENT`, `AUTO_REPLY_ESCALATED`.
4. Add 6 targeted tests:
   - FAQ precedence over AI,
   - in-scope nonstandard uses Gemini,
   - out-of-scope no freeform,
   - complaint escalation,
   - missing Gemini safe fallback,
   - AI logging + persistence metadata.
