const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');

router.use(authenticate, attachBusinessId);

// ─── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const cats = await prisma.category.findMany({
      where: { business_id: req.businessId },
      orderBy: { sort_order: 'asc' },
    });
    res.json({ categories: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const cat = await prisma.category.create({
      data: { ...req.body, business_id: req.businessId },
    });
    res.status(201).json({ category: cat });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/categories/:id', async (req, res) => {
  try {
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const cat = await prisma.category.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ category: cat });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.json({ success: true });
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Menu Items ────────────────────────────────────────────────────────────────

router.get('/items', async (req, res) => {
  try {
    const { category_id, active } = req.query;
    const where = { business_id: req.businessId };
    if (category_id) where.category_id = category_id;
    if (active !== undefined) where.active = active === 'true';

    const items = await prisma.menuItem.findMany({
      where,
      include: { category: { select: { name_ar: true } } },
      orderBy: { sort_order: 'asc' },
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/items/:id', async (req, res) => {
  try {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
      include: {
        modifierGroups: { include: { modifierGroup: true } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function omitClientFields(body) {
  const { id, business_id, ...rest } = body;
  void id; void business_id;
  return rest;
}

router.post('/items', async (req, res) => {
  try {
    const payload = omitClientFields(req.body);

    if (payload.category_id) {
      const cat = await prisma.category.findFirst({
        where: { id: payload.category_id, business_id: req.businessId },
      });
      if (!cat) {
        return res.status(400).json({ error: 'Invalid category_id for this business' });
      }
    }
    const item = await prisma.menuItem.create({
      data: { ...payload, business_id: req.businessId },
    });
    res.status(201).json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const update = omitClientFields(req.body);

    const existing = await prisma.menuItem.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    const item = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: update,
    });
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const existing = await prisma.menuItem.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.json({ success: true });
    await prisma.menuItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Full menu (categories + items together) ───────────────────────────────────

router.get('/full', async (req, res) => {
  try {
    const [categories, items] = await Promise.all([
      prisma.category.findMany({
        where: { business_id: req.businessId, active: true },
        orderBy: { sort_order: 'asc' },
      }),
      prisma.menuItem.findMany({
        where: { business_id: req.businessId, active: true },
        orderBy: { sort_order: 'asc' },
      }),
    ]);

    const menuWithItems = categories.map(cat => ({
      ...cat,
      items: items.filter(i => i.category_id === cat.id),
    }));

    res.json({ menu: menuWithItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
