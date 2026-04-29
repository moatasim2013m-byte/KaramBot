const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const { Category, MenuItem, ModifierGroup } = require('../models/Menu');

router.use(authenticate, attachBusinessId);

// ─── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const cats = await Category.find({ business_id: req.businessId }).sort('sort_order');
    res.json({ categories: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const cat = await Category.create({ ...req.body, business_id: req.businessId });
    res.status(201).json({ category: cat });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/categories/:id', async (req, res) => {
  try {
    const cat = await Category.findOneAndUpdate(
      { _id: req.params.id, business_id: req.businessId },
      req.body,
      { new: true },
    );
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    res.json({ category: cat });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await Category.findOneAndDelete({ _id: req.params.id, business_id: req.businessId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Menu Items ────────────────────────────────────────────────────────────────

router.get('/items', async (req, res) => {
  try {
    const { category_id, active } = req.query;
    const query = { business_id: req.businessId };
    if (category_id) query.category_id = category_id;
    if (active !== undefined) query.active = active === 'true';

    const items = await MenuItem.find(query).populate('category_id', 'name_ar').sort('sort_order');
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/items/:id', async (req, res) => {
  try {
    const item = await MenuItem.findOne({ _id: req.params.id, business_id: req.businessId })
      .populate('modifier_groups');
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/items', async (req, res) => {
  try {
    const item = await MenuItem.create({ ...req.body, business_id: req.businessId });
    res.status(201).json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, business_id: req.businessId },
      req.body,
      { new: true },
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    await MenuItem.findOneAndDelete({ _id: req.params.id, business_id: req.businessId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Full menu (categories + items together) ───────────────────────────────────

router.get('/full', async (req, res) => {
  try {
    const [categories, items] = await Promise.all([
      Category.find({ business_id: req.businessId, active: true }).sort('sort_order'),
      MenuItem.find({ business_id: req.businessId, active: true }).sort('sort_order'),
    ]);

    const menuWithItems = categories.map(cat => ({
      ...cat.toObject(),
      items: items.filter(i => i.category_id?.toString() === cat._id.toString()),
    }));

    res.json({ menu: menuWithItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
