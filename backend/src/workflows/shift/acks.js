/**
 * Every deterministic customer-visible string of the SHIFT bot, in Jordanian Arabic and English.
 *
 * The model is told never to claim that something was recorded or sent; these acks are appended by
 * the server only after the state they describe is persisted, so every «سجّلت» here is true.
 * Pure functions. A segment whose data is unknown is omitted entirely — never printed empty or as
 * "undefined".
 */

const { PRIVACY_SHORT } = require('../../config/site');
const hours = require('./hours');

const ARABIC_LETTER_RE = /[؀-ۿ]/g;
const LATIN_LETTER_RE = /[A-Za-z]/g;
const ARABIZI_RE = /[a-z][2356789]|[2356789][a-z]|\b(shu|sho|keef|kif|bdi|baddi|3ndi|ahlan|mar7aba|marhaba|se3er|kam|tamam|yalla|mat3am|3iyade)\b/i;
// English tokens where a digit touches a letter without being Arabizi: times (5pm, 10:30am), ordinals
// (2nd, 3rd), B2B/B2C, sizes and counts (4G, 10k, 2x, 30min). Removed before the Arabizi test, so
// «Can we talk at 5pm?» is still English. (Departure from the contract regex, which counted them.)
const ENGLISH_DIGIT_TOKENS_RE = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d+(st|nd|rd|th|k|m|g|x|h|hrs?|mins?|pcs?)\b|\b[bcp]2[bcp]\b/gi;

function isEn(lang) {
  return lang === 'en';
}

function pickLanguage(lead, text) {
  if (lead && (lead.language === 'ar' || lead.language === 'en')) return lead.language;
  const s = typeof text === 'string' ? text : '';
  const arabic = (s.match(ARABIC_LETTER_RE) || []).length;
  const latin = (s.match(LATIN_LETTER_RE) || []).length;
  const letters = arabic + latin;
  // Arabizi («mar7aba 3ndi salon») is Latin script but an Arabic speaker: answer in Arabic.
  if (letters > 0 && latin / letters >= 0.7 && !ARABIZI_RE.test(s.replace(ENGLISH_DIGIT_TOKENS_RE, ' '))) return 'en';
  return 'ar';
}

function hoursSegment(teamHours, lang) {
  if (!teamHours) return '';
  return ` (${hours.hoursLabel(teamHours, lang)})`;
}

function contactSegment(contact, lang) {
  const phone = contact && typeof contact.phone === 'string' ? contact.phone.trim() : '';
  const email = contact && typeof contact.email === 'string' ? contact.email.trim() : '';
  const values = [phone, email].filter(Boolean);
  if (!values.length) return '';
  return isEn(lang)
    ? ` For urgent matters: ${values.join(' or ')}.`
    : ` للاستعجال: ${values.join(' أو ')}.`;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function windowRange(startParts, endParts, lang) {
  const a = hours.hourLabel(startParts.hh, startParts.mm);
  const b = hours.hourLabel(endParts.hh, endParts.mm);
  if (isEn(lang)) return `between ${a} and ${b}${endParts.hh >= 13 ? ' pm' : ''}`;
  return `بين ${a} و${b}`;
}

/** 'بكرا بين 10 و12 (الثلاثاء 15/9)' — the wording of a slot everywhere the customer reads it. */
function windowText({ start, end }, now, tz, lang) {
  const zone = tz || hours.DEFAULT_TEAM_HOURS.tz;
  const s = hours.localParts(toDate(start), zone);
  const e = hours.localParts(toDate(end), zone);
  const word = hours.dayWord(s.dateKey, now || new Date(), zone, lang);
  const [, mo, d] = s.dateKey.split('-').map(Number);
  const range = windowRange(s, e, lang);
  const names = isEn(lang) ? hours.WEEKDAYS_EN : hours.WEEKDAYS_AR;
  const weekday = names[s.weekday];
  // For a day further out the day word already is the weekday; repeating it in brackets reads oddly.
  if (word === weekday) {
    return isEn(lang) ? `on ${weekday} ${range} (${d}/${mo})` : `يوم ${weekday} ${range} (${d}/${mo})`;
  }
  return `${word} ${range} (${weekday} ${d}/${mo})`;
}

function openingWords(teamHours, now, lang) {
  const opening = hours.nextOpening(teamHours, now);
  if (!opening) return isEn(lang) ? 'soon' : 'بأقرب وقت';
  const [h, m] = teamHours.from.split(':').map(Number);
  const morning = h < 12;
  const at = hours.hourLabel(h, m);
  if (opening.relation === 'today') {
    return isEn(lang) ? `today at ${at} ${h >= 12 ? 'pm' : 'am'}` : `اليوم الساعة ${at}`;
  }
  if (opening.relation === 'tomorrow') {
    if (morning) return isEn(lang) ? 'tomorrow morning' : 'بكرا الصبح';
    return isEn(lang) ? `tomorrow at ${at} pm` : `بكرا الساعة ${at}`;
  }
  const weekday = (isEn(lang) ? hours.WEEKDAYS_EN : hours.WEEKDAYS_AR)[new Date(`${opening.dateKey}T00:00:00Z`).getUTCDay()];
  if (morning) return isEn(lang) ? `on ${weekday} morning` : `يوم ${weekday} الصبح`;
  return isEn(lang) ? `on ${weekday} at ${at} pm` : `يوم ${weekday} الساعة ${at}`;
}

function handoffLead(lang) {
  return isEn(lang) ? 'Of course.' : 'ولا يهمك.';
}

function handoffAck({ teamHours, contact, now = new Date(), lang } = {}) {
  const contactText = contactSegment(contact, lang);
  const inHours = !teamHours || hours.isWithinTeamHours(teamHours, now);
  if (inHours) {
    const hoursText = hoursSegment(teamHours, lang);
    return isEn(lang)
      ? `Your request is on the team's list with a summary of our chat — nobody has picked it up yet; they reply here during working hours${hoursText}.${contactText} If you need anything meanwhile, I'm here.`
      : `سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون ضمن الدوام${hoursText}.${contactText} لو احتجت أي شي بالوقت هذا أنا هون.`;
  }
  const opening = openingWords(teamHours, now, lang);
  return isEn(lang)
    ? `Your request is on the team's list with a summary of our chat — nobody has picked it up yet; they'll reply here ${opening} when the working day starts.${contactText} If you need anything meanwhile, I'm here.`
    : `سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون ${opening} مع بداية الدوام إن شاء الله.${contactText} لو احتجت أي شي بالوقت هذا أنا هون.`;
}

function handoffRepeat(lang) {
  return isEn(lang)
    ? "Nobody from the team has picked it up yet, and it's flagged for them — if you like, write a time that suits you and I'll add it to the request."
    : 'لسه ما استلمه حدا من الفريق، ومعلّم عندهم — إذا بتحب اكتبلي وقت بيناسبك ونحطّه بالطلب.';
}

function flagAck(reason, { teamHours, lang } = {}) {
  const hoursText = hoursSegment(teamHours, lang);
  if (reason === 'quote') {
    return isEn(lang)
      ? `I've put your quote request on the SHIFT team's list ✅ nobody has picked it up yet — they'll get back to you on this number during working hours${hoursText}. Until then I'm here for any question.`
      : `سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام${hoursText}. لحد ما يردوا أنا هون لأي سؤال.`;
  }
  return isEn(lang)
    ? `I've put your request on the SHIFT team's list ✅ nobody has picked it up yet — they'll get back to you on this number during working hours${hoursText}. Until then I'm here for any question.`
    : `سجّلت طلبك بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام${hoursText}. لحد ما يردوا أنا هون لأي سؤال.`;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function captureAck({ name, businessName, when, lang } = {}) {
  const w = clean(when);
  // No honorific: the server cannot know the customer's gender (contract §12.7).
  if (isEn(lang)) {
    const detail = [clean(name), clean(businessName), w && `${w} Amman time`].filter(Boolean).join(', ');
    return `Call request noted${detail ? `: ${detail}` : ''} — a request, not a confirmed booking; the team will confirm the exact time here. If you'd rather be phoned than messaged, tell me.`;
  }
  const detail = [clean(name), clean(businessName), w && `${w} بتوقيت عمّان`].filter(Boolean).join('، ');
  return `سجّلت طلب مكالمة${detail ? `: ${detail}` : ''} — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي.`;
}

/**
 * D26: the customer asked for a new call time but the stored one is owned by staff (they set or
 * confirmed it), so the lead keeps staff's time. Only the request was recorded and passed on: the
 * wording must not say the time changed.
 */
function captureRelayed({ when, lang } = {}) {
  const w = clean(when);
  if (isEn(lang)) {
    return `I've passed ${w ? `your new time (${w} Amman time)` : 'your request for a new time'} to the team — the time they have is unchanged until they confirm with you here.`;
  }
  return `وصّلت ${w ? `طلبك للوقت الجديد (${w} بتوقيت عمّان)` : 'طلب تغيير الوقت'} للفريق — الوقت المعتمد عندهم ما بتغيّر لحد ما يأكدوا معك هون.`;
}

const SECTOR_NOUNS = { restaurant: 'المطعم', clinic: 'العيادة', store: 'المتجر', other: 'المحل' };

function purposeLine(lang) {
  return isEn(lang)
    ? `(we use what you write to reply to you and organise the team's follow-up — details: ${PRIVACY_SHORT})`
    : `(بنستخدم اللي بتكتبه عشان نرد عليك ونرتّب متابعة الفريق — التفاصيل: ${PRIVACY_SHORT})`;
}

function slotOther(lang) {
  return isEn(lang) ? 'Sure — which day and time suits you?' : 'تمام — أي يوم وساعة بتريحك؟';
}

function captureAsk({ nameKnown, businessKnown, sector, lang } = {}) {
  // Both already known means only the time is missing: ask for it instead of repeating the name.
  if (nameKnown && businessKnown) return slotOther(lang);
  const purpose = purposeLine(lang);
  const noun = SECTOR_NOUNS[sector] || SECTOR_NOUNS.other;
  if (isEn(lang)) {
    if (nameKnown) return `Great. Could you confirm your business name? ${purpose}`;
    if (businessKnown) return `Great. Could you confirm your name? ${purpose}`;
    return `Great. Could you confirm your name and your business name? ${purpose}`;
  }
  if (nameKnown) return `تمام. بس أكّدلي اسم ${noun}؟ ${purpose}`;
  if (businessKnown) return `تمام. بس أكّدلي اسمك؟ ${purpose}`;
  return `تمام. بس أكّدلي اسمك واسم ${noun}؟ ${purpose}`;
}

function expiredSlot(lang) {
  return isEn(lang) ? 'That option is out of date — which day and time suits you now?' : 'الخيار هاد قديم — أي يوم ووقت بناسبك هلأ؟';
}

function aiFailure(lang, { withButtons = false } = {}) {
  if (withButtons) {
    return isEn(lang)
      ? 'Sorry, my reply is delayed right now. Your message reached us and the SHIFT team will continue with you here. If you like, pick a time for a short call:'
      : 'معلش، تأخر ردّي شوي. رسالتك وصلت، وفريق شِفت بيكمّل معك هون. وإذا بتحب نرتّب مكالمة قصيرة، اختار وقت:';
  }
  return isEn(lang)
    ? 'Sorry, my reply is delayed right now. Your message reached us and the SHIFT team will continue with you here.'
    : 'معلش، تأخر ردّي شوي. رسالتك وصلت، وفريق شِفت بيكمّل معك هون.';
}

function optOut(lang) {
  return isEn(lang) ? "Done — I've stopped follow-ups. We're here if you need us." : 'تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون.';
}

function notNow(lang) {
  return isEn(lang)
    ? "Sure, whenever suits you. If you come back we'll pick up where we left off."
    : 'تمام، الوقت إلك. لو رجعت بأي وقت بنكمّل من نفس النقطة.';
}

function claimAck({ staffName, lang } = {}) {
  const staff = clean(staffName);
  if (isEn(lang)) {
    return staff
      ? `${staff} has picked up your request and will continue with you here.`
      : 'Someone from the team has picked up your request and will continue with you here.';
  }
  return staff ? `استلم طلبك ${staff} وبيكمّل معك هون.` : 'استلم طلبك واحد من الفريق وبيكمّل معك هون.';
}

function slaNote(lang) {
  return isEn(lang)
    ? "Your request is still on the team's list and not yet picked up — it's flagged. If you like, write a time that suits you and I'll add it to the request."
    : 'طلبك لسه بالقائمة عند الفريق وما استلمه حدا بعد — معلّم عندهم. إذا بتحب، اكتبلي وقت بيناسبك ونحطّه بالطلب.';
}

function awaitingStaffNote({ staffName, lang } = {}) {
  const staff = clean(staffName);
  return isEn(lang)
    ? `Your message arrived — ${staff || 'the team'} will continue with you here.`
    : `رسالتك وصلت، ${staff || 'الفريق'} بيكمّل معك هون.`;
}

const MEDIA_NOUNS_AR = {
  audio: 'وصلتني رسالتك الصوتية',
  image: 'وصلتني الصورة',
  video: 'وصلني الفيديو',
  document: 'وصلني الملف',
  sticker: 'وصلني الملصق',
};
const MEDIA_NOUNS_EN = {
  audio: 'Got your voice note',
  image: 'Got your image',
  video: 'Got your video',
  document: 'Got your file',
  sticker: 'Got your sticker',
};

function media(type, lang) {
  if (isEn(lang)) {
    return `${MEDIA_NOUNS_EN[type] || 'Got your message'} 🙏 in this chat I read text only — could you type what you need in one line?`;
  }
  return `${MEDIA_NOUNS_AR[type] || 'وصلتني رسالتك'} 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟`;
}

/**
 * Line above a model reply when the batch had an attachment. `captioned`: the attachment came with the
 * only text, so the reply goes by that caption and not by the file itself.
 */
function mediaPrefix(type, lang, { captioned = false } = {}) {
  if (captioned) {
    if (isEn(lang)) return `${MEDIA_NOUNS_EN[type] || 'Got your message'} 🙏 here I read text only, so I'm going by what you wrote.`;
    return `${MEDIA_NOUNS_AR[type] || 'وصلتني رسالتك'} 🙏 هون بقرأ النص بس، فبرد على اللي كتبته.`;
  }
  if (isEn(lang)) return `${MEDIA_NOUNS_EN[type] || 'Got your message'} too 🙏 — here I read text only.`;
  return `${MEDIA_NOUNS_AR[type] || 'وصلتني رسالتك'} كمان 🙏 هون بقرأ النص بس.`;
}

/** Body of a slot-buttons message when the model line is empty. */
function slotsBody(lang) {
  return isEn(lang) ? "The team's nearest times:" : 'أقرب أوقات الفريق:';
}

module.exports = {
  pickLanguage,
  hoursSegment,
  contactSegment,
  windowText,
  openingWords,
  handoffLead,
  handoffAck,
  handoffRepeat,
  flagAck,
  captureAck,
  captureRelayed,
  captureAsk,
  slotOther,
  expiredSlot,
  aiFailure,
  optOut,
  notNow,
  claimAck,
  slaNote,
  awaitingStaffNote,
  media,
  mediaPrefix,
  purposeLine,
  slotsBody,
};
