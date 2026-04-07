const express = require('express');
const rateLimit = require('express-rate-limit');
const Theme = require('../models/Theme');
const AITheme = require('../models/AITheme');
const { generateThemeImage } = require('../utils/geminiImage');
const { uploadBufferToGcs } = require('../utils/gcsUpload');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const aiGenerateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: { error: 'محاولات كثيرة جداً، الرجاء المحاولة بعد 15 دقيقة' }
});

const SAFETY_SUFFIX = 'kid-friendly birthday party theme, no text, no logos, no brands, no real people';

// Get all active themes
router.get('/', async (req, res) => {
  try {
    const themes = await Theme.find({ is_active: true }).sort({ name: 1 });
    res.json({ themes: themes.map(t => t.toJSON()) });
  } catch (error) {
    console.error('Get themes error:', error);
    res.status(500).json({ error: 'Failed to get themes' });
  }
});

router.post('/ai-generate', aiGenerateLimiter, async (req, res) => {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT) {
    return res.status(503).json({ error: 'خدمة توليد الصور غير متاحة حالياً' });
  }

  const rawPrompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const aspectRatio = typeof req.body?.aspectRatio === 'string' ? req.body.aspectRatio.trim() : undefined;

  if (rawPrompt.length < 10 || rawPrompt.length > 300) {
    return res.status(400).json({ error: 'النص يجب أن يكون بين 10 و 300 حرف' });
  }

  const prompt = `${rawPrompt}. ${SAFETY_SUFFIX}`;
  let aiTheme;

  try {
    aiTheme = await AITheme.create({
      prompt: rawPrompt,
      aspect_ratio: aspectRatio || null,
      status: 'pending'
    });

    const { imageBuffer, mimeType } = await generateThemeImage({ prompt, aspectRatio });

    const extension = mimeType && mimeType.includes('jpeg') ? 'jpg' : 'png';
    const objectPath = `ai-themes/${aiTheme._id}.${extension}`;
    const imageUrl = await uploadBufferToGcs({
      objectPath,
      buffer: imageBuffer,
      contentType: mimeType || 'image/png'
    });

    aiTheme.status = 'generated';
    aiTheme.image_url = imageUrl;
    aiTheme.error_message = null;
    await aiTheme.save();

    return res.json({ imageUrl, requestId: aiTheme._id.toString() });
  } catch (error) {
    const providerStatus = Number(error?.status) || null;
    const providerMessage = error?.details?.providerError?.message || null;

    if (providerStatus) {
      console.error('Gemini provider non-200 response:', {
        status: providerStatus,
        message: providerMessage
      });
    }

    console.error('AI theme generation error:', {
      code: error?.code,
      status: providerStatus,
      message: error?.message,
      providerMessage,
      details: error?.details
    });

    if (aiTheme) {
      aiTheme.status = 'failed';
      aiTheme.error_message = 'generation_failed';
      await aiTheme.save();
    }

    const statusCode = error?.code === 'MISSING_API_KEY'
      ? 503
      : providerStatus === 429
        ? 429
        : 502;

    const message = error?.code === 'MISSING_API_KEY'
      ? 'خدمة توليد الصور غير متاحة حالياً'
      : providerStatus === 429
        ? 'تم تجاوز الحد المسموح لخدمة الذكاء الاصطناعي، الرجاء المحاولة لاحقاً'
        : providerStatus === 404
          ? 'موديل إنشاء الصور غير متاح حالياً، الرجاء المحاولة لاحقاً'
          : 'تعذر توليد الصورة حالياً، الرجاء المحاولة لاحقاً';

    return res.status(statusCode).json({ error: message });
  }
});

// Get single theme
router.get('/:id', async (req, res) => {
  try {
    const theme = await Theme.findById(req.params.id);
    if (!theme) {
      return res.status(404).json({ error: 'Theme not found' });
    }
    res.json({ theme: theme.toJSON() });
  } catch (error) {
    console.error('Get theme error:', error);
    res.status(500).json({ error: 'Failed to get theme' });
  }
});

// Admin: Create theme
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, price, image_url } = req.body;
    
    const theme = new Theme({ name, description, price, image_url });
    await theme.save();
    
    res.status(201).json({ theme: theme.toJSON() });
  } catch (error) {
    console.error('Create theme error:', error);
    res.status(500).json({ error: 'Failed to create theme' });
  }
});

// Admin: Update theme
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, price, image_url, is_active } = req.body;
    
    const theme = await Theme.findById(req.params.id);
    if (!theme) {
      return res.status(404).json({ error: 'Theme not found' });
    }

    if (name !== undefined) theme.name = name;
    if (description !== undefined) theme.description = description;
    if (price !== undefined) theme.price = price;
    if (image_url !== undefined) theme.image_url = image_url;
    if (is_active !== undefined) theme.is_active = is_active;
    
    await theme.save();
    res.json({ theme: theme.toJSON() });
  } catch (error) {
    console.error('Update theme error:', error);
    res.status(500).json({ error: 'Failed to update theme' });
  }
});

// Admin: Delete theme
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const theme = await Theme.findById(req.params.id);
    if (!theme) {
      return res.status(404).json({ error: 'Theme not found' });
    }

    theme.is_active = false;
    await theme.save();
    
    res.json({ message: 'Theme deleted' });
  } catch (error) {
    console.error('Delete theme error:', error);
    res.status(500).json({ error: 'Failed to delete theme' });
  }
});

module.exports = router;
