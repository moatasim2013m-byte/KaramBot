const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, attachBusinessId, requireRole } = require('../middleware/auth');
const accountEvents = require('../services/accountEvents');

/**
 * What the agent knows about this business.
 *
 * Scoped by attachBusinessId, so an owner edits their own and a platform_admin must name the
 * account — the same rule as every other tenant route. A restaurant's menu and a clinic's
 * services stay where they are; this is for every other business, whose agent had nothing to
 * say before it.
 */
router.use(authenticate, attachBusinessId, requireRole('platform_admin', 'business_owner', 'manager'));

const KINDS = ['fact', 'faq', 'service', 'hours', 'policy'];
const MAX_CONTENT = 2000;
const MAX_ITEMS = 200;

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

router.get('/', async (req, res) => {
  try {
    const items = await prisma.businessKnowledge.findMany({
      where: { business_id: req.businessId },
      orderBy: [{ kind: 'asc' }, { position: 'asc' }, { created_at: 'asc' }],
    });
    res.json({ items, kinds: KINDS });
  } catch (err) {
    console.error('[knowledge] list failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const kind = String(req.body?.kind || 'fact');
  const content = clean(req.body?.content, MAX_CONTENT);
  const question = req.body?.question ? clean(req.body.question, 300) : null;

  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'نوع غير معروف' });
  if (!content) return res.status(400).json({ error: 'اكتب المعلومة' });
  if (kind === 'faq' && !question) return res.status(400).json({ error: 'اكتب سؤال العميل' });

  try {
    // A cap the owner will never reach by hand, but which stops a paste loop from growing the
    // prompt until the model stops reading the end of it.
    const count = await prisma.businessKnowledge.count({ where: { business_id: req.businessId } });
    if (count >= MAX_ITEMS) return res.status(409).json({ error: `الحد الأقصى ${MAX_ITEMS} معلومة` });

    const item = await prisma.businessKnowledge.create({
      data: {
        business_id: req.businessId, // from the session or the named account, never the body
        kind,
        question: kind === 'faq' ? question : null,
        content,
        position: count,
      },
    });
    res.status(201).json({ item });
  } catch (err) {
    console.error('[knowledge] create failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── «ما عرف يجاوب» ─────────────────────────────────────────────────────────
//
// The questions the bot handed to a person because it did not know the answer: open bot_handoff
// events (messageProcessor writes one only for handoff_kind 'model', never for an owner's keyword
// or a provider failure). Answering one teaches the bot (a faq row) and closes it; dismissing only
// closes it. The event stays in the shop's log either way. Declared before '/:id' so «gaps» is
// never read as a knowledge id.

const GAPS_LIMIT = 50;

const gapView = (e) => ({
  id: e.id,
  question: (e.data && typeof e.data.question === 'string') ? e.data.question : '',
  at: e.created_at,
  conversation_id: (e.data && e.data.conversation_id) || null,
});

const actorKindOf = (req) => (req.user.role === 'platform_admin' ? 'shift' : req.user.role === 'business_owner' ? 'owner' : 'staff');

router.get('/gaps', async (req, res) => {
  try {
    const rows = await accountEvents.list({
      businessId: req.businessId, types: 'bot_handoff', unresolved: true, limit: GAPS_LIMIT,
    });
    res.json({ gaps: rows.map(gapView) });
  } catch (err) {
    console.error('[knowledge/gaps] list failed:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل الأسئلة' });
  }
});

router.post('/gaps/:id/answer', async (req, res) => {
  const answer = clean(req.body?.answer, MAX_CONTENT);
  if (!answer) return res.status(400).json({ error: 'اكتب الجواب' });
  // «category» is the knowledge kind the owner filed it under; a question is a faq unless they chose.
  const kind = req.body?.category === undefined || req.body?.category === null || req.body?.category === ''
    ? 'faq' : String(req.body.category);
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'نوع غير معروف' });

  try {
    // Scoped to this business and still open: another shop's id, or one already handled, is not found.
    const gap = await prisma.accountEvent.findFirst({
      where: { id: String(req.params.id), business_id: req.businessId, type: 'bot_handoff', resolved_at: null },
    });
    if (!gap) return res.status(404).json({ error: 'هذا السؤال غير موجود أو تمت الإجابة عنه' });
    const question = clean(gapView(gap).question, 300) || null;

    const count = await prisma.businessKnowledge.count({ where: { business_id: req.businessId } });
    if (count >= MAX_ITEMS) return res.status(409).json({ error: `الحد الأقصى ${MAX_ITEMS} معلومة` });

    // The row and the closing together: an answer saved with the question still open would be
    // offered again, and a question closed with no answer saved would be lost.
    const item = await prisma.$transaction(async (tx) => {
      const { count: closed } = await tx.accountEvent.updateMany({
        where: { id: gap.id, business_id: req.businessId, resolved_at: null },
        data: { resolved_at: new Date() },
      });
      // Two taps at once: only the first one teaches.
      if (!closed) return null;
      const created = await tx.businessKnowledge.create({
        data: {
          business_id: req.businessId,
          kind,
          // A faq is printed to the model as «س: … ج: …»; the other kinds are statements on their own.
          question: kind === 'faq' ? (question || answer.slice(0, 300)) : null,
          content: answer,
          position: count,
        },
      });
      await tx.accountEvent.create({
        data: accountEvents.toRow({
          businessId: req.businessId, actorUserId: req.user.id, actorKind: actorKindOf(req),
          type: 'knowledge_added', data: { knowledge_id: created.id, from_gap: gap.id, kind },
        }),
      });
      return created;
    });
    if (!item) return res.status(404).json({ error: 'هذا السؤال غير موجود أو تمت الإجابة عنه' });
    res.status(201).json({ item });
  } catch (err) {
    console.error('[knowledge/gaps] answer failed:', err.message);
    res.status(500).json({ error: 'تعذّر الحفظ، حاول مرة أخرى' });
  }
});

router.delete('/gaps/:id', async (req, res) => {
  try {
    const gap = await prisma.accountEvent.findFirst({
      where: { id: String(req.params.id), business_id: req.businessId, type: 'bot_handoff' },
      select: { id: true },
    });
    if (!gap) return res.status(404).json({ error: 'هذا السؤال غير موجود' });
    await accountEvents.resolve(gap.id, { businessId: req.businessId });
    res.json({ dismissed: true });
  } catch (err) {
    console.error('[knowledge/gaps] dismiss failed:', err.message);
    res.status(500).json({ error: 'تعذّر الحفظ، حاول مرة أخرى' });
  }
});

router.patch('/:id', async (req, res) => {
  const data = {};
  if (req.body?.content !== undefined) {
    const content = clean(req.body.content, MAX_CONTENT);
    if (!content) return res.status(400).json({ error: 'اكتب المعلومة' });
    data.content = content;
  }
  if (req.body?.question !== undefined) data.question = req.body.question ? clean(req.body.question, 300) : null;
  if (req.body?.active !== undefined) data.active = Boolean(req.body.active);
  if (req.body?.kind !== undefined) {
    if (!KINDS.includes(req.body.kind)) return res.status(400).json({ error: 'نوع غير معروف' });
    data.kind = req.body.kind;
  }

  try {
    // Scoped to this business: an id from another tenant is simply not found.
    const existing = await prisma.businessKnowledge.findFirst({
      where: { id: req.params.id, business_id: req.businessId }, select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'لا توجد معلومة بهذا المعرّف' });

    const item = await prisma.businessKnowledge.update({ where: { id: existing.id }, data });
    res.json({ item });
  } catch (err) {
    console.error('[knowledge] update failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.businessKnowledge.findFirst({
      where: { id: req.params.id, business_id: req.businessId }, select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'لا توجد معلومة بهذا المعرّف' });
    await prisma.businessKnowledge.delete({ where: { id: existing.id } });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[knowledge] delete failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
