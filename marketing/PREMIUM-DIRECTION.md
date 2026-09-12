# Premium direction — approved 2026-09-10: «أ · فخامة هادئة» + ops card from «ب · مسرح المنتج»

Applies ON TOP of DESIGN-CONTRACT.md (this file wins where they differ). Reference artboards (exact markup + inline values): `marketing/design/premium/Main.dc.html` (phone), `MainDesktop.dc.html` (1440), `DirectionB.dc.html` (the dark glass ops card); renders in the same folder (`*.png`). Canvas: https://claude.ai/code/artifact/e5940e7c-19c2-490b-92f3-42ced0908526

## Tokens (replace the contract's `:root` values)
```
--ground:#F5F6F9   --surface:#FFFFFF   --ink:#0F1E38   --ink-2:#1B2D4F   --text:#3D4A63   --muted:#6B7891
--line:#E3E7EE     --line-2:#EEF1F5    --hair:#B9C2D0  (eyebrow rule)     --chip-line:#D3D9E3
--electric:#1F6BFF (links, selected chips' text on light only; NOT for fills)   --electric-soft:#E8F0FF
--gold:#F2B33D  (exactly: logo dot 8px, flagship badge/border, ROI number, current step)
--wa:#25D366  --wa-ink:#062b1a  (WhatsApp CTAs only)
--r-pill:999px  --r:16px  --r-card:20px  --r-panel:24px
--shadow-card: 0 18px 44px -30px rgba(15,30,56,.40)      (ONLY on the ops panel, the phone, the ROI result)
--ease: cubic-bezier(.2,.7,.2,1)  --fast:160ms  --base:220ms
```
Dark glass panel (the ops card only — the single dark island on the page):
```
--panel-bg: radial-gradient(75% 42% at 50% 20%, rgba(31,107,255,.28), rgba(31,107,255,0) 72%), linear-gradient(180deg,#0B1526 0%,#0F1E38 100%)
--glass: rgba(255,255,255,.05)  --glass-line: rgba(255,255,255,.10)  --glass-row: rgba(255,255,255,.04)  --glass-row-line: rgba(255,255,255,.08)
--glass-hot: rgba(34,211,238,.08) / border rgba(34,211,238,.45)   (the NEWEST row only — i.e. the last one streamed in)
--glass-icon-bg: rgba(31,107,255,.22)  --glass-icon: #9CC0FF  --glass-text:#EAF0F9  --glass-muted:#8FA0BD  --glass-badge-line: rgba(255,255,255,.18)
```

## Typography
- Google Fonts: `Alexandria:wght@500;600;700` (display) + `IBM Plex Sans Arabic:wght@400;500;600` (body). **Cairo is removed.** Fallback stack for both: `'Cairo','Segoe UI',system-ui,sans-serif`. `display=swap`.
- Display (Alexandria): wordmark 22px/700 (desktop 24), H1 34px/1.32/600 (desktop 52px/1.25, max-width 14ch), H2 26px/1.35/600 (desktop 34), card titles 16px/600. `letter-spacing:0`, `text-wrap:balance`.
- Body (IBM Plex Sans Arabic): 16px/1.8 `--text`; proof/lede 16px (desktop 19px/1.75); small 13px/1.6 `--muted`; eyebrow 12.5px/500 `--muted` preceded by a 24px×1px `--hair` rule (desktop 32px); row text 14.5px/1.5 `--ink-2`; times 12px `--muted` tabular.
- Buttons 16px/600; chips 14px/500; badges 11px.

## Components (exact)
- **Nav** 56px (desktop 72), bottom hairline `--line`, padding 0 20px (desktop 0 64px). Wordmark = 8px gold square (radius 2px) + «شِفت». End: «EN» 13px/500 muted, then WhatsApp circle 40px `--wa` with the 20px glyph in `--wa-ink` (desktop: a 44px pill «واتساب»). Desktop links 14px/500 muted, gap 28px.
- **Opening**: padding 36px 20px 0; eyebrow → H1 → proof (max-width 34ch) → CTA pill 52px full-width `--wa`/`--wa-ink` with glyph → note 13px muted centered «بلا التزام · نردّ خلال ساعات العمل». Gap 16px. Desktop: 2-col grid, gap 64px, text start / ops panel end (480px wide, centered in its column), secondary text link «شاهد كرم يردّ ↓» with underline offset 6px, color `--ink`, underline color `--hair`.
- **Ops panel (dark glass)**: margin 28px 20px 0, padding 16px, background `--panel-bg`, border 1px `--glass-line`, radius `--r-panel`, shadow `--shadow-card`. Header: title 16px/600 white (Alexandria), subtitle 13px `--glass-muted`, badge «مثال توضيحي» 11px `--glass-text` with `--glass-badge-line` pill. Rows: flex column gap 8px; each row padding 12px 14px, radius 14px, `--glass-row` + 1px `--glass-row-line`; icon 32px square radius 10px `--glass-icon-bg` with 16px stroke icon `--glass-icon`; text 14.5px `--glass-text`; time 12px `--glass-muted` tabular at the end. 3 rows at first paint, stream 5 more, the newest (last) row gets `--glass-hot`. Footer row: «تحديث 10:06 ص» (real time) / «N أحداث هذا الصباح» 12.5px. No shadow inside rows, no gold.
- **Sector chips**: pills 44px, 14px/500, 1px `--chip-line`, gap 8px; selected = `--ink` fill, white text; 15px stroke icon in currentColor. Label above: 12.5px/500 muted «مصمّم للعيادات والمطاعم والمتاجر الإلكترونية».
- **Light cards** (products, cases, demos, team, contact): `--surface`, 1px `--line`, radius `--r-card`, NO shadow; inner dividers `--line-2`; icon holders 32px circles `#F1F3F7` with `--ink` strokes.
- **Phone (#karam)**: frame `--ink` with radius `--r-panel`, shadow `--shadow-card`; chat surface stays WhatsApp-like (#EFE9E1 body, white/#D9FDD3 bubbles) — that is the product's real look, keep it.
- **ROI result card**: `--surface`, shadow `--shadow-card`, number 40px Alexandria 700 in `--gold`.
- **Sticky bar**: `--wa` pill 48px only (contract rule), on a translucent `--ground` strip with a top hairline.
- Motion: as the contract (≤240ms, opacity/transform only); ops rows enter with 200ms opacity + translateY(4px).

## Rules
- Gold in exactly the four spots listed under tokens; green only on WhatsApp CTAs; the dark glass style is used ONLY for the ops panel — nothing else on the page is dark (no dark chapters, no dark stats).
- One shadow token, three uses. Everything else is hairlines.
- Every section keeps its structure and behavior from the rebuild; this is a restyle, not a re-architecture.
