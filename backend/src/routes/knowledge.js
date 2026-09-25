const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, attachBusinessId, requireRole } = require('../middleware/auth');

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
