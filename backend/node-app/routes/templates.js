const express = require('express');
const TemplateDefinition = require('../models/TemplateDefinition');
const { authMiddleware, staffMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// ==================== TEMPLATE ROUTES ====================

/**
 * GET /api/templates
 * List approved WhatsApp templates
 */
router.get('/', authMiddleware, staffMiddleware, async (req, res) => {
  try {
    const { status, category, page = 1, limit = 50 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    
    const templates = await TemplateDefinition.find(query)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await TemplateDefinition.countDocuments(query);
    
    res.json({
      templates,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

/**
 * POST /api/templates/sync
 * Sync templates from Meta Business Manager
 * 
 * NOTE: This is a placeholder. Real implementation would call Meta Graph API:
 * GET https://graph.facebook.com/v18.0/{WABA_ID}/message_templates
 * 
 * For now, we'll allow manual creation for testing
 */
router.post('/sync', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // TODO: Implement actual Meta API sync
    // This would require:
    // 1. WABA_ID and access token with message_template_management permission
    // 2. Call GET /message_templates endpoint
    // 3. Parse response and upsert to TemplateDefinition
    
    // For testing, return mock response
    res.json({
      success: true,
      message: 'Template sync not yet implemented. Use POST /api/templates to create templates manually.',
      synced_count: 0
    });
  } catch (error) {
    console.error('Sync templates error:', error);
    res.status(500).json({ error: 'Failed to sync templates' });
  }
});

/**
 * POST /api/templates
 * Manually create template (for testing)
 */
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      meta_template_id,
      name,
      status,
      language,
      category,
      body_text,
      variables,
      header_type,
      footer_text,
      buttons
    } = req.body;
    
    if (!meta_template_id || !name || !category || !body_text) {
      return res.status(400).json({ error: 'Required fields: meta_template_id, name, category, body_text' });
    }
    
    // Check for duplicate
    const existing = await TemplateDefinition.findOne({ meta_template_id });
    if (existing) {
      return res.status(400).json({ error: `Template ${meta_template_id} already exists` });
    }
    
    const template = new TemplateDefinition({
      meta_template_id,
      name,
      status: status || 'approved',
      language: language || 'en_US',
      category,
      body_text,
      variables: variables || [],
      header_type,
      footer_text,
      buttons: buttons || [],
      synced_from_meta_at: new Date()
    });
    
    await template.save();
    
    res.status(201).json({
      success: true,
      template
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * GET /api/templates/:id
 * Get single template
 */
router.get('/:id', authMiddleware, staffMiddleware, async (req, res) => {
  try {
    const template = await TemplateDefinition.findById(req.params.id);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ template });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

module.exports = router;
