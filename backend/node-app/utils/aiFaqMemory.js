const AIFaqMemory = require('../models/AIFaqMemory');

const MAX_CANDIDATES = 60;
const MAX_RESULTS = 3;
const MIN_QUERY_TOKEN_LENGTH = 2;

const normalizeArabicText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\u0640/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenizeArabic = (value) =>
  normalizeArabicText(value)
    .split(' ')
    .filter((token) => token && token.length >= MIN_QUERY_TOKEN_LENGTH);

const countPhraseMatches = (normalizedQuery, phrases = []) => {
  if (!normalizedQuery) return 0;
  let matches = 0;

  phrases.forEach((phrase) => {
    const normalizedPhrase = normalizeArabicText(phrase);
    if (!normalizedPhrase) return;

    if (normalizedQuery.includes(normalizedPhrase)) {
      matches += 1;
    }
  });

  return matches;
};

const countTokenOverlap = (queryTokens, docTokens) => {
  if (!queryTokens.length || !docTokens.length) return 0;

  const querySet = new Set(queryTokens);
  let overlap = 0;

  docTokens.forEach((token) => {
    if (querySet.has(token)) overlap += 1;
  });

  return overlap;
};

const isUsableApprovedEntry = (doc) => {
  const approvedAnswer = normalizeArabicText(doc?.approved_answer_ar);
  if (!approvedAnswer) return false;

  const hasIntent = normalizeArabicText(doc?.intent_key).length > 0;
  const hasVariants = Array.isArray(doc?.question_variants) && doc.question_variants.some((item) => normalizeArabicText(item).length > 0);
  const hasTags = Array.isArray(doc?.tags) && doc.tags.some((item) => normalizeArabicText(item).length > 0);
  const hasFacts = Array.isArray(doc?.short_facts) && doc.short_facts.some((item) => normalizeArabicText(item).length > 0);

  return hasIntent || hasVariants || hasTags || hasFacts;
};

const rankFaqMemory = ({ queryText, docs }) => {
  const normalizedQuery = normalizeArabicText(queryText);
  const queryTokens = tokenizeArabic(normalizedQuery);

  if (!normalizedQuery || !queryTokens.length) return [];

  const ranked = docs
    .filter((doc) => isUsableApprovedEntry(doc))
    .map((doc) => {
      const phrases = [
        doc.intent_key,
        ...(Array.isArray(doc.question_variants) ? doc.question_variants : []),
        ...(Array.isArray(doc.tags) ? doc.tags : []),
        ...(Array.isArray(doc.short_facts) ? doc.short_facts : [])
      ];

      const docTokens = tokenizeArabic(phrases.join(' '));
      const overlapScore = countTokenOverlap(queryTokens, docTokens);
      const phraseScore = countPhraseMatches(normalizedQuery, phrases);
      const priorityScore = Number(doc.priority) || 0;
      const score = overlapScore * 3 + phraseScore * 5 + priorityScore;

      return {
        doc,
        score,
        overlapScore,
        phraseScore,
        priorityScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.phraseScore !== a.phraseScore) return b.phraseScore - a.phraseScore;
      if (b.overlapScore !== a.overlapScore) return b.overlapScore - a.overlapScore;
      return b.priorityScore - a.priorityScore;
    });

  return ranked.slice(0, MAX_RESULTS).map((item) => item.doc);
};

const getApprovedFaqMemory = async ({ queryText, limit = MAX_RESULTS } = {}) => {
  const safeLimit = Math.max(1, Math.min(5, Number(limit) || MAX_RESULTS));

  const candidates = await AIFaqMemory.find({ status: 'approved' })
    .select('category intent_key question_variants approved_answer_ar short_facts tags source status priority usage_count last_used_at')
    .sort({ priority: -1, updated_at: -1 })
    .limit(MAX_CANDIDATES)
    .lean();

  const ranked = rankFaqMemory({ queryText, docs: candidates });
  return ranked.slice(0, safeLimit);
};

module.exports = {
  normalizeArabicText,
  getApprovedFaqMemory
};
