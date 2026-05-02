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

// ─── Modifier Groups ───────────────────────────────────────────────────────────

router.get('/modifier-groups', async (req, res) => {
  try {
    const groups = await prisma.modifierGroup.findMany({
      where: { business_id: req.businessId },
      orderBy: { name_ar: 'asc' },
    });
    res.json({ modifier_groups: groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/modifier-groups', async (req, res) => {
  try {
    const { name_ar, name_en, required, min_select, max_select, options } = req.body;
    if (!name_ar) return res.status(400).json({ error: 'name_ar is required' });

    const group = await prisma.modifierGroup.create({
      data: {
        business_id: req.businessId,
        name_ar,
        name_en: name_en || null,
        required: required ?? false,
        min_select: min_select ?? 0,
        max_select: max_select ?? 1,
        options: options || [],
      },
    });
    res.status(201).json({ modifier_group: group });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/modifier-groups/:id', async (req, res) => {
  try {
    const existing = await prisma.modifierGroup.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Modifier group not found' });

    const { name_ar, name_en, required, min_select, max_select, options } = req.body;
    const data = {};
    if (name_ar !== undefined) data.name_ar = name_ar;
    if (name_en !== undefined) data.name_en = name_en;
    if (required !== undefined) data.required = required;
    if (min_select !== undefined) data.min_select = parseInt(min_select);
    if (max_select !== undefined) data.max_select = parseInt(max_select);
    if (options !== undefined) data.options = options;

    const group = await prisma.modifierGroup.update({ where: { id: req.params.id }, data });
    res.json({ modifier_group: group });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/modifier-groups/:id', async (req, res) => {
  try {
    const existing = await prisma.modifierGroup.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.json({ success: true });
    await prisma.modifierGroup.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menu/items/:id/modifier-groups — link modifier groups to an item
router.post('/items/:id/modifier-groups', async (req, res) => {
  try {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { modifier_group_ids } = req.body;
    if (!Array.isArray(modifier_group_ids)) {
      return res.status(400).json({ error: 'modifier_group_ids must be an array' });
    }

    // Verify all groups belong to this business
    const groups = await prisma.modifierGroup.findMany({
      where: { id: { in: modifier_group_ids }, business_id: req.businessId },
    });
    if (groups.length !== modifier_group_ids.length) {
      return res.status(400).json({ error: 'One or more modifier_group_ids are invalid' });
    }

    await prisma.$transaction([
      prisma.menuItemModifierGroup.deleteMany({ where: { menu_item_id: req.params.id } }),
      prisma.menuItemModifierGroup.createMany({
        data: modifier_group_ids.map(gid => ({ menu_item_id: req.params.id, modifier_group_id: gid })),
        skipDuplicates: true,
      }),
    ]);

    const updated = await prisma.menuItem.findUnique({
      where: { id: req.params.id },
      include: { modifierGroups: { include: { modifierGroup: true } } },
    });
    res.json({ item: updated });
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
