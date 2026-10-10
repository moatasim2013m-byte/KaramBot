'use strict';

// A kunya or a title is half a name: «أبو» alone greets nobody.
const PREFIXES = new Set(['أبو', 'ابو', 'أم', 'ام', 'د.', 'د']);

/**
 * What a person is greeted and listed by: «أبو خالد» from «أبو خالد الشامي», «أحمد» from «أحمد
 * سالم». Used by the /join welcome («أهلًا أبو خالد»), the invite message and the board's cards,
 * so the three never call the same owner differently.
 */
function firstName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.length > 1 && PREFIXES.has(words[0])) return `${words[0]} ${words[1]}`;
  return words[0];
}

module.exports = { firstName };
