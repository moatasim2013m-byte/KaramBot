# Admin panel — what it is for, and how it gets there

The owner could not tell whether the admin panel monitors **chats** or **customer accounts**.
That is not a UI problem. The panel genuinely does both, because a platform admin is shown a
dashboard built for a business owner plus one extra link.

Reviewed 2026-09-23 with three outside models through OpenRouter: GPT-6 Astra (architecture),
Kimi K3 (critique), DeepSeek V4 Pro (build plan). Their full answers are in the session; what
follows is the decision.

---

## The answer

**The admin panel exists to keep SHIFT's customer accounts running. It is not for reading their
customers' conversations** — with one deliberate exception, below.

Chats belong to the business that owns them. SHIFT staff look at an account's *health*: is it
connected, is the agent answering, what broke, what changed.

## Why it is confusing today

| Today | Problem |
|---|---|
| `platform_admin` lands on `/overview` | That page shows open chats, orders today, revenue today — a business owner's screen |
| Inbox appears if the admin happens to have a `business_id` | Navigation changes based on a data accident |
| Same Settings page for platform and business | Neither audience gets a settings page that means anything |
| Labels: الرئيسية, الأعمال, إضافة عمل | Say nothing about whose home, or what kind of business |
| `slug` is a primary column; `wa_phone_number_id` is masked to look like a phone number | Internal identifiers presented as user-facing facts |
| One `status` field implies account = connection = agent | Three different things that fail independently |

## The shape it should take

**Separate route trees, not a workspace switcher.** `/admin/*` for SHIFT staff with its own shell;
business users keep `/overview`, `/inbox`. A `platform_admin` with a `business_id` still lands in
`/admin` — navigation must never depend on that accident.

**Admin navigation is three items:** platform overview, company accounts, platform settings.
Account detail is tabbed (details / WhatsApp connection / AI agent / activity), not more sidebar.

**The admin overview answers five questions**, with the attention queue as the protagonist:

1. How many accounts, and where in their lifecycle — onboarding, active, inactive, suspended
2. Which account needs help first — the prioritised attention queue
3. Is each account technically able to serve customers — health table, three separate states
4. Is each account actually seeing traffic, and is the agent answering
5. What changed recently, and **who changed it** — owner edits are the most common cause of "the bot broke"

**Three states, never collapsed into one:** account status, WhatsApp connection (connected /
degraded / disconnected, plus Meta's quality rating and messaging tier), agent state. Unknown
telemetry renders as **unknown** — a hollow grey dot — never as healthy.

## The exception: an audited read-only workspace view

SHIFT sells a bot's replies. When an owner reports "the bot quoted the wrong price", a health
table will show the agent *responding*, because it is — wrongly. Cutting admins off from the
output removes the one thing an AI company must watch, and pushes support towards asking owners
for their passwords.

So: from account detail, an explicit **عرض مساحة العمل** — read-only, logged, behind a persistent
banner naming the account. An inspection hatch, not a switcher. The default landing stays clean.

## What "premium" means here, concretely

Not adjectives:

- **Density** — 34–36px rows, 12–13px data text, tabular numerals, one account per line, status as
  8px dots rather than pill badges. The four hero stat cards become a slim totals strip.
- **One protagonist per screen** — the attention queue anchors the overview full width, and
  collapses to a single green line when everything is fine.
- **Colour means state only** — delete the blue/orange/green/purple card rainbow, which is the
  internal-CRUD-template tell. One brand hue plus greys.
- **Typography** — hard weight contrast, identifiers and numbers in `dir="ltr"` tabular figures,
  relative timestamps with absolute on hover. Arabic has no uppercase; do not fake it with
  letter-spacing on headings.
- **Motion** — 120–180ms ease-out, nothing bouncy. Skeletons shaped like the final layout, not
  «جاري التحميل...».
- **Empty states are the product succeeding** — an empty attention queue should say so, with a
  check and «كل الحسابات تعمل منذ ٣ أيام», not grey text.

## Build order

**Phase 1 — separation.** Split the route trees, admin shell, redirect every `platform_admin` to
`/admin/overview` regardless of `business_id`, purge the ambiguous labels. This alone removes the
confusion, and is worth shipping before anything else.

**Phase 2 — visibility.** `GET /api/admin/overview` (totals, health, recent events), the health
table, totals strip, activity feed, and an attention queue limited at first to signals that
already exist.

**Phase 3 — depth.** Accounts list rebuilt, account detail with onboarding checklist, test-message
tool, real platform settings.

**Phase 4 — the hatch and the polish.** Audited read-only workspace view, the full attention queue
once detection rules exist, skeletons and motion.

## Not to be skipped

- **Define the attention queue's detection rules before building its UI** — webhook silent > N
  minutes, token expiring, fallback rate spiking, handoffs waiting on staff. Ship the widget
  without rules and the centrepiece of the overview is empty or noisy.
- **"Last agent response" is not success.** A bot replying «لم أفهم» to everything has a fresh
  timestamp and is failing. Track fallback rate, unanswered rate, and stale handoffs.
- **Capability flags come from explicit entitlements**, never from a missing `business_type`.
