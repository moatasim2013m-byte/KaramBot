# WhatsApp Marketing System — PRD

## Original Problem Statement
1. Audit WhatsApp marketing implementation against Meta Marketing Messages docs
2. Make `POST /api/staff/campaigns/manual-bulk-send` async (return 202, background processing)
3. Add header image support for templates with image headers
4. Fix 3 compliance gaps: category check, consent check, staff opt-out consent clearing

## Architecture
- Backend: Node.js/Express in `/app/backend/node-app/`, proxied via FastAPI wrapper on port 8001
- Database: MongoDB Atlas
- Frontend: React
- WhatsApp: Meta Cloud API v25.0, Marketing Messages endpoint (`/marketing_messages`)
- Deployment: GCP Cloud Run

## Completed
- [x] Meta Compliance Audit v1 — all 7 pillars COMPLIANT (Apr 2026)
- [x] Meta Compliance Audit v2 — full doc review, NO CODE CHANGE NEEDED (Apr 2026)
- [x] Async manual-bulk-send — returns 202, background processing via setImmediate (Apr 2026)
- [x] Header image support — templates with image headers work in bulk send (Apr 2026)
- [x] Contact import — 2,135 contacts from kids_master_list.xlsx + 147 WhatsApp contacts (Apr 2026)
- [x] Fix 1: Category check added to manual-bulk-send (Apr 2026)
- [x] Fix 2: Consent check added to manual-bulk-send (Apr 2026)
- [x] Fix 3: Staff opt-out now clears whatsapp_marketing_consent (Apr 2026)
- [x] WhatsApp bot: typing indicator, 5s burst window, Gemini context caching, media fallback fixes, Jordanian Arabic vocab, DB readiness gate (Feb 2026)
- [x] Staff Panel shell extraction — shared `DashboardLayout`/`Sidebar`/`Header`/`MobileNav` in `frontend/src/components/admin/`, `StaffPage` now wraps existing tabs in the new shell (Feb 2026)

- [x] `adminCron.js` fallback fixed — `whatsapp-followup` cron now skips silently with `{skipped_run: true, skip_reason: 'missing_template_setting'}` when `whatsapp_followup_template_name` setting is absent, instead of falling back to the `peekaboo_test_campaign` test template (Feb 2026)
- [x] WhatsApp routing patches (Feb 2026, strict-patch):
   - OUT_OF_SCOPE token-match: `OUT_OF_SCOPE_KEYWORDS` checks (lines 934, 1582 of `autoReplyBot.js`) now use `includesAnyExactToken` instead of `includesAnyKeyword` — fixes "بدي احجز بكره" being falsely escalated because "بكره" contained the substring "كرة".
   - Handoff de-dup: `escalation_handoff` added to `DUPLICATE_INTENT_SUPPRESSION_KEYS` so the safety/complaint handoff message is suppressed for 15 min after first send.
   - Diagnostic log `[ROUTE_FINAL]` added immediately before `postWhatsAppText` (logs `inboundText`, `matchedKey`, `replyPreview`) to identify the route producing the play_pricing reply for "لعب بالساعة". No behavioural change.
   - Booking-duration revival (Feb 2026, strict-patch): added `lastBotReplyAskedBookingDuration` + `isBookingDurationFollowUp` helpers in `autoReplyBot.js` (~line 75–110) and a second clause to the booking-state revival block (~line 1715) so a reply like "3 ساعات" / "ساعتين" / "4" stays inside the booking flow even when the previous booking-duration question was emitted via `ai_primary` (regular Gemini) instead of `ai_booking` (tool path). All 25 unit cases pass; no DB / dependency / UI / booking-flow redesign.

- [x] **Public UI design refactor with Shroomi mascot integration (Feb 2026, presentation-only)**:
   - New reusable `<Shroomi pose="..." />` component at `frontend/src/components/Shroomi.js` with **28 distinct poses** sourced from the 3 user-uploaded sprite sheets (sheets cropped via Pillow into transparent PNGs, ~2.4 MB total).
   - New stylesheet `frontend/src/styles/shroomi-premium.css` (registered in `index.css`) with: pk-premium-hero, pk-section-eyebrow, pk-pcard, pk-trust-strip, pk-booking-hero, pk-stepper, pk-loyalty-card, pk-summary-card, pk-auth-invite, pk-cta-band, plus shroomi-float / shroomi-bob / shroomi-pop-in / shroomi-halo utility classes.
   - `HomePage.js`: Shroomi added as a **journey character** in 5 distinct positions/poses — `point-side` (hero, desktop) + `wave` (hero, mobile), `heart-hold` (trust section), `clock` / `party-confetti` / `tag-discount` / `clipboard-write` (service-card corners), `point` (services eyebrow), `phone-photo` (gallery eyebrow), `party-confetti` + `thumbs-up-big` (final CTA band). Section eyebrows (`pk-section-eyebrow`) added to all major sections in brand colors (yellow / blue / red / green).
   - `TicketsPage.js`: legacy `shroomi-promo--mega` block replaced with a clean `pk-booking-hero` (eyebrow + title + subtitle + premium pill stepper). Shroomi appears as `clipboard-write` (booking journey guide), `thumbs-up-big` (booking summary "ready zone"), `party-coins` (loyalty redemption "rewards" feel), `wave` (auth invite). All 4 booking steps + payment + coupon + loyalty + sticky CTA logic preserved exactly — verified by smoke-test (date → period → duration step transitions trigger correct stepper state, no console errors).
   - **Zero business logic changed**: same useState / useEffect / pricing / loyalty redemption preview / payment / slot fetching; only JSX wrappers, classNames, and decorative Shroomi inserts. RTL (Arabic-first) preserved on every change.

- [x] **Public UI design — extension to Birthday + Subscriptions (Feb 2026, presentation-only)**:
   - `BirthdayPage.js`: legacy `shroomi-promo--events` block + `SkyBackground` + `SmilingSun` overlays replaced with the same `pk-booking-page` + `pk-booking-hero` premium pattern. Pink-tinted eyebrow ("احتفال لا يُنسى — كيك، بالونات، وفرحة"), red `shroomi-halo`. Shroomi integrated as: `party-big` (hero — celebration guide), `jump-cheer` (themes section header — picks the theme), `thumbs-up-big` (booking summary card — "ready to book"), `balloons` (auth invite — birthday-themed welcome). Pose choices avoid the "party-hat-looks-like-a-second-mushroom" artifact at small sizes.
   - `SubscriptionsPage.js`: legacy `shroomi-promo--subscriptions` "Join Now!" hero + Sky/Sun overlays replaced with the same `pk-booking-page` + `pk-booking-hero`. Yellow/orange-tinted eyebrow ("وفّر أكثر مع باقات الزيارات المتكررة"). Shroomi integrated as: `gift-magic` (hero — premium/value guide), `thumbs-up` (basic plan corner), `tag-discount` (most-popular plan corner — savings emphasis), `party-coins` (premium plan corner — rewards feel), `prayer` (auth invite — "please join"). Each plan tier gets its own pose so he never feels copy-pasted.
   - **Zero business logic changed** on both pages: same fetchPlans / fetchThemes / fetchSlots / handlePurchase / handleStandardBooking / handleCustomRequest / handleGenerateAiTheme — only JSX, classNames, and decorative Shroomi inserts. RTL preserved. Lint clean on both files. Smoke screenshots confirmed both heroes render correctly and existing flows (date selection, slot picking, theme picking, purchase button, auth invite buttons) unaffected.

- [x] **Public UI — Groups + HomeParty + Birthday Loader2 fix (Feb 2026, presentation-only)**:
   - **Bug fix**: `BirthdayPage.js` was referencing `Loader2` (lines 587, 656) without importing it from `lucide-react`. Added the import. Verified runtime page load now produces zero console pageerrors.
   - `GroupsPage.js` (uses shared `PublicPageShell`): added `clipboard-write` Shroomi (96px, green-halo, peek-from-corner) on the "coming soon" callout — fits the "schools/groups program" framing; tiny `thumbs-up` Shroomi inline in the "نعمل على تجهيز البرنامج" pill; `heart-hold` Shroomi (68px, blue-halo) on the features section header — anchors the safety/care pillars. Eyebrow tag added ("قريباً"). Rewrote copy to be warmer ("اتركوا لنا التفاصيل وسنرتب الزيارة المثالية").
   - `HomePartyPage.js` (uses shared `PublicPageShell`): added `gift-magic` Shroomi (104px, orange-halo, peek-from-corner) on the "coming soon" callout — sets the at-home celebration tone; tiny `balloons` Shroomi inline in the "نحضّر أجواء بيتك للاحتفال" pill; `jump-cheer` Shroomi (72px, red-halo) on the features section header. Eyebrow tag added.
   - `PublicPageShell.js` was **not modified** (it's shared by other pages — kept untouched per scope).
   - **Zero business logic changed**: WhatsApp + phone CTAs, `data-testid` attributes, all preserved exactly. Only JSX and decorative Shroomi inserts. Lint clean on all 3 files; smoke screenshots verified at 1280px viewport.

- [x] **Mobile customer nav UX — unified quick-nav strip (Feb 2026, presentation-only)**:
   - `frontend/src/components/Navbar.js`: removed the homepage-only inline pill block (`mobile-home-headlines`) and replaced it with a single horizontally-scrollable quick-nav strip rendered on **all** customer pages (mobile only, `md:hidden`) below the navbar row. Strip uses the new `mobileQuickNavItems` source: الرئيسية + اللعب بالساعة + أعياد الميلاد + الاشتراكات + حجوزاتي (last one only when authed customer). Active-route highlighting preserved.
   - `frontend/src/index.css`: added `.mobile-quick-nav-strip` + `.mobile-quick-nav-track` styles — soft top-border, padded, RTL-aware leading-edge fade hint, hidden scrollbar (Firefox + WebKit), scroll-snap proximity, `flex: 0 0 auto` pills.
   - Verified at 390px on `/`, `/tickets`, `/birthday`, `/subscriptions`, `/groups`: strip renders with 4 pills (unauthed) and is scrollable. Desktop unchanged (strip hidden on `md+`, original 3-pill desktop nav preserved). Hamburger now only handles secondary links.
   - **Mission 2 (decorative kids-themed background) confirmed already in place**: `sky-theme` class (sky-blue gradient + animated cloud + balloon SVG decorations + `pointer-events:none` + `z-index:0`) is applied to all customer pages via the `Layout` wrapper in `App.js`. No change required for Mission 2.
   - **Zero backend / logic changes**: only Navbar JSX + CSS additions. RTL preserved.

## Backlog
- [ ] Apply the same `DashboardLayout` shell to `AdminPage.js` (legacy, still uses Tabs + Navbar). New admin at `/app/frontend/src/pages/admin/AdminLayout.js` already uses a sidebar layout.
