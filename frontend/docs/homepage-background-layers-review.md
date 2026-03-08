# Homepage Background Layers Review

## Scope
This review maps how the homepage (`frontend/src/pages/HomePage.js`) composes visual background layers and which CSS rules currently control stacking, opacity, and depth.

## Rendered layer order (back to front)
1. **Global sky layer component**
   - `<SkyBackground className="home-sky-layer" />` is mounted as the first child in `.home-page`.
   - It renders `.sky-background` plus 5 animated cloud elements.
2. **Hero section background plane**
   - `.home-hero-sky` applies radial decorative blobs and a vertical gradient.
   - `::before` and `::after` pseudo-elements add cloud-like pills in the hero area.
3. **Hero decorative overlay wrapper**
   - `.home-hero-decor` is absolutely positioned with `z-index: 1`.
4. **Hero content shell**
   - `.home-hero-shell` is positioned with `z-index: 2` to keep card/media above hero décor.
5. **Page sections over the sky**
   - Non-sky children of `.home-page` are forced to `z-index: 1` via `.home-page > *:not(.home-sky-layer)`.

## Current CSS controls affecting layers
- `.home-sky-layer`
  - fixed to viewport (`position: fixed; inset: 0; z-index: 0;`) and dimmed (`opacity: 0.42`).
- `.home-page`
  - declares `position: relative`, `overflow-x` clipping, and a themed base background.
- `.home-hero-sky`
  - `position: relative` with section gradient + radial overlays.
  - pseudo-elements (`::before`, `::after`) are absolutely positioned decorative clouds.
- `.sky-background`
  - internal container used by `SkyBackground`; cloud elements animate across X-axis.

## Notable findings
- **Layering is intentionally split between component and section CSS**
  - Base animated sky is page-level (`home-sky-layer`), while hero ornaments stay section-scoped (`home-hero-sky` + pseudo-elements).
- **Z-index strategy is mostly consistent**
  - Sky at `z-index: 0`, content at `z-index: 1+`, and hero shell explicitly elevated to `z-index: 2`.
- **Opacity tuning keeps fixed sky subtle**
  - `opacity: 0.42` on `.home-sky-layer` avoids overpowering cards/text.
- **CSS duplication/override risk exists in `index.css`**
  - The homepage selectors (`.home-page`, `.home-sky-layer`, `.home-hero-sky`, `.hero-image-panel`) are redefined in multiple blocks, so later declarations are the effective source of truth.

## Recommendation (non-breaking)
- Consolidate homepage layer rules into one dedicated section/file (or clearly mark "final overrides") to reduce accidental regressions from duplicate selectors.
