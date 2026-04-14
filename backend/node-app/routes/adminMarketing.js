const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { authMiddleware, staffMiddleware, staffPermissionMiddleware } = require('../middleware/auth');
const MarketingContact = require('../models/MarketingContact');
const MarketingImportBatch = require('../models/MarketingImportBatch');
const MarketingCampaign = require('../models/MarketingCampaign');
const MarketingCampaignRecipient = require('../models/MarketingCampaignRecipient');
const { normalizePhoneForWhatsApp } = require('../utils/whatsappBookingConfirmation');
const { logger } = require('../utils/logger');
const {
  getAudienceQuery,
  createRecipientsForCampaign,
  verifyTemplate,
  syncOptOutForMarketingContact
} = require('../utils/marketingCampaignService');

let xlsxLib = null;
try {
  xlsxLib = require('xlsx');
} catch (_err) {
  xlsxLib = null;
}

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

router.use(authMiddleware, staffMiddleware);
router.use(staffPermissionMiddleware('access_whatsapp_campaigns'));

const parseCsvLine = (line) => {
  const out = [];
  let cur = '';
  let insideQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (ch === ',' && !insideQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
};

const parseCsv = (rawBuffer) => {
  const text = rawBuffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = String(values[idx] || '').trim();
    });
    return row;
  });
};

const parseXlsx = (rawBuffer) => {
  if (!xlsxLib) {
    throw new Error('xlsx_not_enabled');
  }

  const workbook = xlsxLib.read(rawBuffer, { type: 'buffer' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const rows = xlsxLib.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [String(k).toLowerCase(), String(v || '').trim()])));
};

const parseBoolean = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return ['1', 'yes', 'true', 'y', 'نعم', 'موافق'].includes(normalized);
};

const getFirstValue = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && String(row[key]).trim()) return String(row[key]).trim();
  }
  return '';
};

const toStringList = (value) => String(value || '').split(/[,;|]/).map((item) => item.trim()).filter(Boolean);

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const filename = String(req.file.originalname || 'import.csv');
    const ext = filename.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx'].includes(ext)) {
      return res.status(400).json({ error: 'Only csv or xlsx files are allowed' });
    }

    logger.info({ event: 'marketing_import_started', filename, staff_id: req.user._id });

    const rows = ext === 'csv' ? parseCsv(req.file.buffer) : parseXlsx(req.file.buffer);

    const batch = await MarketingImportBatch.create({
      original_filename: filename,
      source_type: ext,
      created_by: req.user._id,
      notes: String(req.body.notes || '')
    });

    let createdCount = 0;
    let updatedCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    const seen = new Set();

    for (const row of rows) {
      const phoneRaw = getFirstValue(row, ['phone', 'mobile', 'number', 'whatsapp']);
      const normalized = normalizePhoneForWhatsApp(phoneRaw);

      if (!normalized) {
        invalidCount += 1;
        continue;
      }

      if (seen.has(normalized)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(normalized);

      const fullName = getFirstValue(row, ['name', 'full_name', 'customer_name', 'parent_name']);
      const childName = getFirstValue(row, ['child_name']);
      const tags = toStringList(getFirstValue(row, ['tags']));
      const segment = toStringList(getFirstValue(row, ['segment']));
      const optInRaw = getFirstValue(row, ['opt_in', 'consent']);
      const parsedOptIn = parseBoolean(optInRaw);

      const existing = await MarketingContact.findOne({ normalized_wa_id: normalized }).lean();
      const next = {
        full_name: fullName || existing?.full_name || '',
        phone_raw: phoneRaw,
        normalized_wa_id: normalized,
        child_name: childName || existing?.child_name || '',
        source: 'excel_import',
        tags,
        segment,
        language_code: existing?.language_code || 'ar',
        consent_source: parsedOptIn === true ? 'import_file' : (existing?.consent_source || ''),
        import_batch_id: batch._id,
        meta: { ...existing?.meta, import_row: row },
        is_active: existing?.is_active !== false
      };

      if (parsedOptIn !== null) {
        next.has_whatsapp_opt_in = parsedOptIn;
      } else if (!existing) {
        next.has_whatsapp_opt_in = false;
      }

      if (existing?.whatsapp_opted_out_at) {
        next.whatsapp_opted_out_at = existing.whatsapp_opted_out_at;
      }

      if (existing) {
        await MarketingContact.updateOne({ _id: existing._id }, { $set: next });
        updatedCount += 1;
      } else {
        await MarketingContact.create(next);
        createdCount += 1;
      }
    }

    await MarketingImportBatch.updateOne(
      { _id: batch._id },
      {
        $set: {
          total_rows: rows.length,
          created_count: createdCount,
          updated_count: updatedCount,
          invalid_count: invalidCount,
          duplicate_count: duplicateCount
        }
      }
    );

    logger.info({ event: 'marketing_import_completed', batch_id: batch._id, createdCount, updatedCount, invalidCount, duplicateCount });

    return res.json({
      success: true,
      batch_id: batch._id,
      total_rows: rows.length,
      created_count: createdCount,
      updated_count: updatedCount,
      invalid_count: invalidCount,
      duplicate_count: duplicateCount
    });
  } catch (error) {
    logger.error({ event: 'marketing_import_failed', error: error.message, stack: error.stack });
    return res.status(500).json({ error: `Import failed: ${error.message}` });
  }
});

router.get('/imports', async (req, res) => {
  const items = await MarketingImportBatch.find({}).sort({ created_at: -1 }).limit(100).populate('created_by', 'name email').lean();
  res.json({ items });
});

router.get('/imports/:id', async (req, res) => {
  const item = await MarketingImportBatch.findById(req.params.id).populate('created_by', 'name email').lean();
  if (!item) return res.status(404).json({ error: 'Import batch not found' });
  res.json({ item });
});

router.get('/contacts', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 30)));
  const query = {};

  if (req.query.q) {
    query.$or = [
      { full_name: { $regex: String(req.query.q), $options: 'i' } },
      { phone_raw: { $regex: String(req.query.q), $options: 'i' } },
      { normalized_wa_id: { $regex: String(req.query.q), $options: 'i' } }
    ];
  }
  if (req.query.tag) query.tags = req.query.tag;
  if (req.query.segment) query.segment = req.query.segment;
  if (req.query.has_whatsapp_opt_in !== undefined) query.has_whatsapp_opt_in = req.query.has_whatsapp_opt_in === 'true';
  if (req.query.is_opted_out === 'true') query.whatsapp_opted_out_at = { $ne: null };
  if (req.query.is_opted_out === 'false') query.whatsapp_opted_out_at = null;
  if (req.query.import_batch_id && mongoose.Types.ObjectId.isValid(req.query.import_batch_id)) query.import_batch_id = req.query.import_batch_id;

  const [items, total] = await Promise.all([
    MarketingContact.find(query).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    MarketingContact.countDocuments(query)
  ]);

  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/contacts/:id', async (req, res) => {
  const item = await MarketingContact.findById(req.params.id).lean();
  if (!item) return res.status(404).json({ error: 'Contact not found' });
  res.json({ item });
});

router.patch('/contacts/:id', async (req, res) => {
  const allowed = ['full_name', 'tags', 'segment', 'language_code', 'has_whatsapp_opt_in', 'consent_note', 'is_active'];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) patch[key] = req.body[key];
  }

  const item = await MarketingContact.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!item) return res.status(404).json({ error: 'Contact not found' });
  res.json({ success: true, item });
});

router.post('/contacts/:id/opt-out', async (req, res) => {
  const contact = await MarketingContact.findById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  await syncOptOutForMarketingContact(contact, true);
  res.json({ success: true });
});

router.post('/contacts/:id/opt-in', async (req, res) => {
  const contact = await MarketingContact.findById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  await syncOptOutForMarketingContact(contact, false);
  await MarketingContact.updateOne({ _id: contact._id }, { $set: { has_whatsapp_opt_in: true } });
  res.json({ success: true });
});

router.post('/campaigns', async (req, res) => {
  try {
    const {
      name,
      description,
      template_name,
      language_code,
      template_components,
      audience_type,
      audience_filter,
      scheduled_at
    } = req.body;

    if (!name || !template_name) return res.status(400).json({ error: 'name and template_name are required' });
    const templateApproved = await verifyTemplate(template_name);
    if (!templateApproved) return res.status(400).json({ error: 'Template is missing or not approved in Meta sync table' });

    const campaign = await MarketingCampaign.create({
      name,
      description: description || '',
      template_name,
      language_code: language_code || 'ar',
      template_components: Array.isArray(template_components) ? template_components : [],
      audience_type: audience_type || 'all',
      audience_filter: audience_filter || {},
      status: 'draft',
      created_by: req.user._id,
      scheduled_at: scheduled_at || null
    });

    const count = await MarketingContact.countDocuments(getAudienceQuery(campaign));
    await MarketingCampaign.updateOne({ _id: campaign._id }, { $set: { total_recipients: count } });

    res.status(201).json({ success: true, campaign: { ...campaign.toObject(), total_recipients: count } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/campaigns', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const query = {};
  if (req.query.status) query.status = req.query.status;

  const [items, total] = await Promise.all([
    MarketingCampaign.find(query).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).populate('created_by', 'name').lean(),
    MarketingCampaign.countDocuments(query)
  ]);

  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

router.get('/campaigns/:id', async (req, res) => {
  const campaign = await MarketingCampaign.findById(req.params.id).populate('created_by', 'name email').lean();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ campaign });
});

router.patch('/campaigns/:id', async (req, res) => {
  const allowed = ['name', 'description', 'template_name', 'language_code', 'template_components', 'audience_type', 'audience_filter', 'scheduled_at', 'status'];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) patch[key] = req.body[key];
  }

  const campaign = await MarketingCampaign.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['draft', 'paused', 'queued'] } },
    { $set: patch },
    { new: true }
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found or not editable' });

  res.json({ success: true, campaign });
});

router.post('/campaigns/:id/queue', async (req, res) => {
  const campaign = await MarketingCampaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!['draft', 'paused'].includes(campaign.status)) return res.status(400).json({ error: 'Only draft/paused campaigns can be queued' });

  const templateApproved = await verifyTemplate(campaign.template_name);
  if (!templateApproved) return res.status(400).json({ error: 'Template is missing or not approved' });

  const stats = await createRecipientsForCampaign(campaign);
  campaign.status = 'queued';
  campaign.approved_by = req.user._id;
  await campaign.save();

  logger.info({ event: 'marketing_campaign_queued', campaign_id: campaign._id, recipients: stats.total, queued_by: req.user._id });

  res.json({ success: true, campaign_id: campaign._id, recipients: stats.total, inserted: stats.inserted || 0 });
});

router.post('/campaigns/:id/pause', async (req, res) => {
  const updated = await MarketingCampaign.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['queued', 'running'] } },
    { $set: { status: 'paused' } },
    { new: true }
  );

  if (!updated) return res.status(400).json({ error: 'Campaign is not running/queued' });
  res.json({ success: true, status: updated.status });
});

router.post('/campaigns/:id/resume', async (req, res) => {
  const updated = await MarketingCampaign.findOneAndUpdate(
    { _id: req.params.id, status: 'paused' },
    { $set: { status: 'queued' } },
    { new: true }
  );

  if (!updated) return res.status(400).json({ error: 'Campaign is not paused' });
  res.json({ success: true, status: updated.status });
});

router.post('/campaigns/:id/cancel', async (req, res) => {
  const updated = await MarketingCampaign.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['draft', 'queued', 'running', 'paused'] } },
    { $set: { status: 'canceled', completed_at: new Date() } },
    { new: true }
  );

  if (!updated) return res.status(400).json({ error: 'Campaign cannot be canceled' });
  res.json({ success: true, status: updated.status });
});

router.get('/campaigns/:id/recipients', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const query = { campaign_id: req.params.id };
  if (req.query.status) query.status = req.query.status;

  const [items, total] = await Promise.all([
    MarketingCampaignRecipient.find(query)
      .populate('marketing_contact_id', 'full_name phone_raw tags segment has_whatsapp_opt_in whatsapp_opted_out_at')
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    MarketingCampaignRecipient.countDocuments(query)
  ]);

  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

router.get('/campaigns/preview/count', async (req, res) => {
  const fakeCampaign = {
    audience_type: req.query.audience_type || 'all',
    audience_filter: {
      import_batch_id: req.query.import_batch_id,
      tags: req.query.tags,
      segment: req.query.segment,
      q: req.query.q,
      contact_ids: req.query.contact_ids ? String(req.query.contact_ids).split(',') : []
    }
  };

  const total = await MarketingContact.countDocuments(getAudienceQuery(fakeCampaign));
  res.json({ total });
});

module.exports = router;
