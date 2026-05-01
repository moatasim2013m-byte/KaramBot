const mongoose = require('mongoose');

// ─── Category ────────────────────────────────────────────────────────────────
const categorySchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  name_ar: { type: String, required: true },
  name_en: String,
  sort_order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

// ─── Modifier Option ─────────────────────────────────────────────────────────
const modifierOptionSchema = new mongoose.Schema({
  name_ar: { type: String, required: true },
  name_en: String,
  price_delta: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { _id: true });

// ─── Modifier Group ──────────────────────────────────────────────────────────
const modifierGroupSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  name_ar: { type: String, required: true },
  name_en: String,
  required: { type: Boolean, default: false },
  min_select: { type: Number, default: 0 },
  max_select: { type: Number, default: 1 },
  options: [modifierOptionSchema],
}, { timestamps: true });

// ─── Menu Item ────────────────────────────────────────────────────────────────
const menuItemSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  name_ar: { type: String, required: true },
  name_en: String,
  description_ar: String,
  description_en: String,
  price: { type: Number, required: true, min: 0 },
  image_url: String,
  active: { type: Boolean, default: true },
  available: { type: Boolean, default: true },
  modifier_groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ModifierGroup' }],
  sort_order: { type: Number, default: 0 },
  tags: [String], // e.g. ['spicy', 'vegetarian']
}, { timestamps: true });

const Category = mongoose.model('Category', categorySchema);
const ModifierGroup = mongoose.model('ModifierGroup', modifierGroupSchema);
const MenuItem = mongoose.model('MenuItem', menuItemSchema);

module.exports = { Category, MenuItem, ModifierGroup };
