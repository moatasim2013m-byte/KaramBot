'use strict';

/**
 * Phone numbers as WhatsApp needs them: digits only, country code included.
 *
 * Lifted out of workflows/shift/calendly.js, which is where it grew and was hardened against
 * what people actually type — Arabic-Indic digits, «+962», «00962», a bare local «079…», the
 * «9620…» double-zero form. It lives here because more than one caller needs it now (the
 * Calendly parser and the owner's alert numbers), and two phone parsers would drift apart.
 *
 * Returns null for anything it cannot turn into a plausible number, so a caller can drop it
 * rather than store something the sender would reject.
 */

/** Arabic-Indic and Persian digits → ASCII; bidi marks and NBSP → plain. */
function westernDigits(s) {
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/＋/g, '+');
}

function normalizePhone(raw) {
  let s = westernDigits(raw).trim();
  if (!s) return null;
  let intl = false;
  s = s.replace(/[\s\-.()/]/g, '');
  if (s.startsWith('+')) {
    intl = true;
    s = s.slice(1);
  } else if (s.startsWith('00')) {
    intl = true;
    s = s.slice(2);
  }
  if (!/^\d+$/.test(s)) return null;
  let d = s;
  if (d.startsWith('9620')) d = `962${d.slice(4)}`;
  if (!intl && !d.startsWith('962')) {
    if (/^07\d{8}$/.test(d)) d = `962${d.slice(1)}`;
    else if (/^7\d{8}$/.test(d)) d = `962${d}`;
    else return null;
  }
  if (d.length < 8 || d.length > 15) return null;
  if (d.startsWith('962') && !/^962\d{8,9}$/.test(d)) return null;
  return d;
}

module.exports = { westernDigits, normalizePhone };
