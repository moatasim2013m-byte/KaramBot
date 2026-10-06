// WhatsApp text formatting, as the real apps render it:
//   *bold*   _italic_   ~strikethrough~   `monospace`
// plus URL auto-linking and "jumbo emoji" detection (a message that is only
// 1–3 emoji renders extra large). Pure functions — no React, no DOM — so the
// parser is testable with plain node (frontend/__tests__/waMarkdown.smoke.cjs).
//
// Deliberately NOT supported (matching WhatsApp's own limits): nesting across
// newlines (a marker pair must sit on one line) and partial-marker leftovers
// (an unclosed * stays literal).

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,!?؟،])/g;
const STYLE_RE = /(\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~|`([^`\n]+)`)/;

/**
 * @returns {Array<{t:'text'|'bold'|'italic'|'strike'|'mono'|'link', v:string, href?:string}>}
 */
export const parseWaMarkdown = (input) => {
  const text = String(input ?? '');
  const out = [];

  // Pass 1 — split out URLs so style markers inside a URL are never mangled.
  const chunks = [];
  let last = 0;
  let m;
  const re = new RegExp(URL_RE.source, 'g');
  while ((m = re.exec(text))) {
    if (m.index > last) chunks.push({ link: false, v: text.slice(last, m.index) });
    chunks.push({ link: true, v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) chunks.push({ link: false, v: text.slice(last) });

  // Pass 2 — inline styles inside the non-link chunks.
  for (const c of chunks) {
    if (c.link) { out.push({ t: 'link', v: c.v, href: c.v }); continue; }
    let rest = c.v;
    while (rest) {
      const sm = STYLE_RE.exec(rest);
      if (!sm) { out.push({ t: 'text', v: rest }); break; }
      if (sm.index > 0) out.push({ t: 'text', v: rest.slice(0, sm.index) });
      if (sm[2] != null) out.push({ t: 'bold', v: sm[2] });
      else if (sm[3] != null) out.push({ t: 'italic', v: sm[3] });
      else if (sm[4] != null) out.push({ t: 'strike', v: sm[4] });
      else if (sm[5] != null) out.push({ t: 'mono', v: sm[5] });
      rest = rest.slice(sm.index + sm[1].length);
    }
  }
  return out;
};

// A message that is ONLY 1–3 emoji (grapheme clusters, so skin tones and ZWJ
// families count as one) renders jumbo-size, like the original apps.
export const isJumboEmoji = (input) => {
  const text = String(input ?? '').trim();
  if (!text || text.length > 24) return false;
  try {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const clusters = [...seg.segment(text)].map((s) => s.segment);
    if (clusters.length === 0 || clusters.length > 3) return false;
    return clusters.every((c) => /\p{Extended_Pictographic}/u.test(c));
  } catch {
    // Very old engines without Intl.Segmenter: skip the jumbo treatment.
    return false;
  }
};
