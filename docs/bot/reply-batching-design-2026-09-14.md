# Karam Bot — answer message bursts together, never miss a reply (design for review)

**Status:** proposal, not implemented. Written 2026-09-14 for a second opinion (ChatGPT) before any code changes.

**Superseded 2026-09-14 (rev. 2 of the sales-bot design):** `sales-bot-design-2026-09-14.md` §7.3 is now the source of truth. Differences: the batch is keyed on `Message.status <> 'answered'` (not an `answered_up_to` timestamp); the Graph send happens *outside* the DB transaction with an outbound-intent row and status-webhook reconciliation (an ambiguous send is never retried automatically); "CPU always allocated" is **not** set in `cloudbuild.yaml` today and must be added explicitly (`--no-cpu-throttling`, `--min-instances=1`) or Cloud Scheduler becomes the only trigger; AI failure keeps the AI on (`status:'pending'`, `needs_team.ai_failure`) instead of switching to human takeover; a staff reply mid-batch leaves the inbound `awaiting_staff` rather than marking it answered.

## Paste this into ChatGPT

---

You are reviewing a reliability design for a production WhatsApp AI bot. Be critical and concrete. List failure
modes that still cause a **missed**, **duplicate**, **out-of-order** or **stale** reply, and say what you would change.
Answer in under 700 words, with numbered points.

### System
- Node 20 + Express + Prisma 5 + Postgres on **Neon, connected through the `-pooler` host (PgBouncer, transaction
  mode)**, so session-level advisory locks are not reliable.
- Google Cloud Run: **CPU always allocated**, min instances 0, max 20. An instance can be stopped after ~15 min idle.
- WhatsApp Cloud API webhooks. Meta retries a webhook that doesn't get a 2xx and can deliver the same message twice.
- The AI is Gemini `gemini-3.6-flash`, typically **7–10 s** per reply (up to ~15 s).
- WhatsApp rule: free-form replies are only allowed within **24 h** of the customer's last message.

### Current behaviour (the problem)
1. The webhook route returns 200 immediately, then calls `processInboundMessage(entry)` without awaiting it.
2. For each message: save it (deduped on unique `meta_message_id`), run the AI **immediately**, and send a reply.
3. Seen in production: a customer sent 2 messages 1 s apart. That caused 2 concurrent AI calls and 2 replies, and
   neither reply saw the other message. The AI timed out at 15 s, and the fallback "a team member will contact you"
   was sent twice.

### Goal
- Several messages sent close together get **one** combined answer.
- **No message is ever left unanswered.** If the AI fails, a fixed fallback is sent.
- **Never send an answer to an older batch after a newer customer message has arrived.**
- No duplicate replies across instances or webhook retries.
- No schema migration if avoidable. `conversations.metadata` (jsonb) is available.

### Proposed design
1. **Save** every inbound message synchronously, as today.
2. **Debounce:** after saving, call `scheduleReply(conversationId)`. It sets an in-memory per-conversation timer with
   a **4 s quiet window**, capped at **12 s** after the first unanswered message.
3. **Lease instead of lock (works through PgBouncer):**
   `UPDATE conversations SET metadata = jsonb_set(metadata,'{reply_lease}', to_jsonb(now() + interval '60 seconds'))
    WHERE id=$1 AND (metadata->>'reply_lease' IS NULL OR (metadata->>'reply_lease')::timestamptz < now())`.
   If rowCount is 1, this worker owns the conversation. Only database `now()` is used, never the Node clock.
4. **The batch** is the inbound messages with `created_at > metadata.answered_up_to` (the last inbound message
   already answered), oldest first. If the batch is empty, release the lease and stop.
5. **Generate:** one AI call with the prior history plus all batch messages. Images and voice join the batch as
   placeholder lines.
6. **Freshness check before sending:** re-read. If an inbound newer than the batch exists, drop the draft and
   regenerate with the larger batch (at most 2 regenerations), then send whatever is current. Also re-check that
   `ai_enabled` is still true and the status isn't `human_takeover`, since a staff member may have taken over in
   the dashboard.
7. **Send:** one WhatsApp reply, with one retry on network or 5xx errors. Save the outbound message, set
   `answered_up_to` to the newest batch message, and clear the lease, all in one transaction. If new inbound
   arrived meanwhile, call `scheduleReply` again.
8. **AI failure:** timeout raised to 30 s, one retry on timeout or 5xx. If it still fails, send the fixed handoff
   text and switch the conversation to human takeover. The customer is never left in silence.
9. **Send failure:** increment `metadata.reply_failures`. After 3 failures, stop retrying and log an alert, so a
   permanent error can't loop forever.
10. **Sweeper (safety net):** every 60 s on each instance, and once at startup, find conversations that meet all
    of these:
    - `ai_enabled` is true and the status is `open`
    - `last_inbound_at` is within 24 h
    - they have inbound messages newer than `answered_up_to`, older than 30 s
    - no live lease

    For each, call `scheduleReply`. This covers instances that were stopped mid-reply and lost in-memory timers.
    The lease prevents duplicates across instances.
11. **Webhook retries:** already deduped by the unique `meta_message_id`, so a duplicate never creates a new batch.

### Questions
1. Is the jsonb lease with database `now()` safe under PgBouncer transaction mode with Prisma? Is a 60 s lease
   enough for up to 2 regenerations × up to 30 s AI calls, or should the lease be renewed during generation?
2. Should the sweeper be replaced by Cloud Scheduler → an authenticated endpoint, since min instances is 0 and no
   instance may be running to sweep?
3. Is "drop the draft when a newer message arrives" right, or should we send it and answer the new message next?
   Consider cost, latency and the customer experience.
4. What happens to a batch when a staff member replies manually from the dashboard in the middle of it?
5. Anything that still loses or duplicates a reply?

---

## My own review before ChatGPT (Claude Code)

Risks I see in the design above, which ChatGPT's answer should be checked against:

- **Min instances 0:** the in-process sweeper only runs while an instance is alive. A message arriving always wakes
  an instance, so new messages are covered. But if an instance dies mid-reply and no further traffic comes, nothing
  sweeps until the next request. Options:
  - **Cloud Scheduler** calling an authenticated `/internal/sweep` every minute. It costs almost nothing and is
    independent of traffic.
  - **min instances 1**, which costs money.
- **Lease length versus a slow AI call:** 2 regenerations × 30 s can exceed a 60 s lease, and a second worker
  could then start. The fix is to renew the lease before each AI call and verify ownership (with a lease token)
  before sending.
- **`answered_up_to` versus "newest outbound":** an outbound message is not proof the customer's question was
  answered. A staff reply can land in the middle of a batch, and a failed send leaves no outbound. Tracking the
  last answered inbound message avoids both problems.
- **A staff reply mid-batch:** if a human replied after the batch started, the bot should not also answer.
  Re-check before sending: if there is a newer outbound from staff (`sent_by_user_id` set), skip.
- **24 h window:** the sweeper must not answer anything older than 24 h. The existing `canSendAutoReply` covers
  this and stays.
- **Order of replies:** one worker per conversation, enforced by the lease, keeps replies in order.
- **Duplicate fallback texts:** today each concurrent failure sends the handoff text. With one worker per
  conversation, that happens at most once per batch.
- **Tests:** the existing `multiBusiness` tests expect `processInboundMessage` to save synchronously. That stays
  the same. New unit tests would cover:
  - batching of 3 messages into one AI call
  - regeneration when a newer message arrives
  - lease contention
  - an AI failure leading to exactly one fallback
  - a send failure cap
  - the sweeper picking up an orphaned batch
