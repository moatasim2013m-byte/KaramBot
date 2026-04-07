const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { getJwtSecret, optionalAuthMiddleware } = require('../middleware/auth');
const { sendVerificationEmail, sendEmail, emailTemplates, isResendConfigured, getSenderEmail, getSenderFrom } = require('../utils/email');

const router = express.Router();

// Email delivery diagnostic endpoint (no auth, no secrets exposed)
router.get('/email-debug', (req, res) => {
  res.json({
    has_resend_key: isResendConfigured(),
    sender_email: getSenderEmail(),
    sender_from: getSenderFrom(),
    frontend_url: process.env.FRONTEND_URL || null
  });
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password and name are required' });
    }

    // Password minimum length validation
    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    // SECURITY: Require FRONTEND_URL to prevent open redirect
    if (!process.env.FRONTEND_URL) {
      console.error('REGISTER_ERROR: FRONTEND_URL environment variable is missing');
      return res.status(500).json({ error: 'FRONTEND_URL missing' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Generate email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const password_hash = await bcrypt.hash(password, 10);
    const user = new User({
      email: email.toLowerCase(),
      password_hash,
      name,
      phone: phone ? phone.replace(/\s/g, '') : null,
      role: 'parent',
      email_verified: false,
      email_verify_token: verifyToken,
      email_verify_expires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    await user.save();
    
    console.log('REGISTER_SUCCESS', user.email);

    // Send verification email - ONLY use process.env.FRONTEND_URL (no fallbacks for security)
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
    
    let emailSent = false;
    try {
      const emailResult = await sendVerificationEmail(user.email, verifyUrl);
      emailSent = emailResult.success;
      if (emailSent) {
        console.log('REGISTER_VERIFY_EMAIL_SENT', user.email);
      } else {
        console.error('REGISTER_VERIFY_EMAIL_FAILED', emailResult.error);
      }
    } catch (emailError) {
      console.error('REGISTER_VERIFY_EMAIL_ERROR', emailError.message || emailError);
      // Continue - don't block registration if email fails
    }

    if (emailSent) {
      res.status(201).json({
        message: 'تم إرسال رابط التفعيل إلى بريدك الإلكتروني',
        email_sent: true
      });
    } else {
      res.status(201).json({
        message: 'تم إنشاء الحساب، لكن تعذر إرسال رسالة التفعيل. الرجاء المحاولة لاحقاً.',
        email_sent: false
      });
    }
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if email is verified (skip for admin/staff)
    if (!user.email_verified && user.role === 'parent') {
      return res.status(403).json({ error: 'يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول' });
    }

    const token = jwt.sign({ userId: user._id }, getJwtSecret(), { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify Email
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'الرابط غير صالح' });
    }

    const user = await User.findOne({ email_verify_token: token });
    
    if (!user) {
      return res.status(400).json({ error: 'الرابط غير صالح' });
    }

    if (user.email_verify_expires && user.email_verify_expires < new Date()) {
      return res.status(400).json({ error: 'الرابط منتهي الصلاحية' });
    }

    user.email_verified = true;
    user.email_verify_token = null;
    user.email_verify_expires = null;
    await user.save();

    res.json({ success: true, message: 'تم تفعيل الحساب بنجاح' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'فشل تأكيد البريد الإلكتروني' });
  }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Do not reveal whether account exists
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'إذا كان الحساب موجودًا، فسيتم إرسال رسالة تفعيل جديدة.'
      });
    }

    if (user.email_verified) {
      return res.status(400).json({ error: 'هذا البريد الإلكتروني مفعل بالفعل' });
    }

    // SECURITY: Require FRONTEND_URL to prevent open redirect
    if (!process.env.FRONTEND_URL) {
      console.error('RESEND_VERIFY_ERROR: FRONTEND_URL environment variable is missing');
      return res.status(500).json({ error: 'FRONTEND_URL missing' });
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    user.email_verify_token = verifyToken;
    user.email_verify_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
    const emailResult = await sendVerificationEmail(user.email, verifyUrl);

    if (!emailResult.success) {
      console.error('RESEND_VERIFY_EMAIL_FAILED', emailResult.error);
      return res.status(500).json({ error: 'تعذر إرسال رسالة التفعيل، حاول مرة أخرى لاحقًا' });
    }

    return res.json({ success: true, message: 'تم إرسال رسالة تفعيل جديدة إلى بريدك الإلكتروني' });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res.status(500).json({ error: 'تعذر إعادة إرسال رسالة التفعيل' });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ ok: false, message: 'Email required' });
    }

    console.log('FORGOT_START', email);

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log('FORGOT_NO_USER');
      // Don't reveal if email exists
      return res.status(200).json({ ok: true, message: 'If the email exists, a reset link will be sent' });
    }

    console.log('FORGOT_USER_FOUND');

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.reset_token = resetToken;
    user.reset_token_expires = new Date(Date.now() + 3600000); // 1 hour (60 minutes)
    await user.save();

    const baseUrl = process.env.FRONTEND_URL; // Required env var validated at startup
    const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    console.log('FORGOT_LINK_OK', resetLink);
    
    const template = emailTemplates.passwordReset(resetLink);
    
    try {
      await sendEmail(user.email, template.subject, template.html);
      console.log('FORGOT_EMAIL_SENT', user.email);
    } catch (emailError) {
      console.error('FORGOT_EMAIL_ERROR', emailError.message || emailError);
      // Continue and return success to user (don't reveal email sending failure)
    }

    return res.status(200).json({ ok: true, message: 'If the email exists, a reset link will be sent' });
  } catch (error) {
    console.error('FORGOT_PASSWORD_UNHANDLED_ERROR', error);
    // Always return success even on error - don't reveal system state
    return res.status(200).json({ ok: true, message: 'If the email exists, a reset link will be sent' });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    const user = await User.findOne({
      reset_token: token,
      reset_token_expires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    user.password_hash = await bcrypt.hash(password, 10);
    user.reset_token = undefined;
    user.reset_token_expires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get current user
router.get('/me', optionalAuthMiddleware, async (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }

  return res.json({ user: req.user.toJSON() });
});

module.exports = router;
