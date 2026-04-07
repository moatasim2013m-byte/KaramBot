const bcrypt = require('bcryptjs');
const User = require('../models/User');

const parseBoolean = (value) => {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const bootstrapAdminUser = async () => {
  const enabled = parseBoolean(process.env.ADMIN_BOOTSTRAP_ENABLED);
  if (!enabled) {
    console.log('ADMIN_BOOTSTRAP_SKIPPED: admin bootstrap skipped (disabled)');
    return;
  }

  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  const name = (process.env.ADMIN_BOOTSTRAP_NAME || '').trim() || 'Admin';
  const resetIfExists = parseBoolean(process.env.ADMIN_BOOTSTRAP_RESET_IF_EXISTS);

  if (!email || !password) {
    console.log('ADMIN_BOOTSTRAP_SKIPPED: admin bootstrap skipped (missing required env vars)');
    return;
  }

  const existingUser = await User.findOne({ email });

  if (!existingUser) {
    const password_hash = await bcrypt.hash(password, 10);
    await User.create({
      email,
      password_hash,
      name,
      role: 'admin',
      email_verified: true
    });
    console.log('ADMIN_BOOTSTRAP_CREATED: admin created');
    return;
  }

  if (!resetIfExists) {
    if (existingUser.role !== 'admin') {
      existingUser.role = 'admin';
      await existingUser.save();
      console.log('ADMIN_BOOTSTRAP_UPDATED_ROLE: admin bootstrap skipped (existing user role updated to admin)');
      return;
    }

    console.log('ADMIN_BOOTSTRAP_SKIPPED: admin bootstrap skipped (admin exists and reset disabled)');
    return;
  }

  existingUser.password_hash = await bcrypt.hash(password, 10);
  existingUser.role = 'admin';
  existingUser.name = name || existingUser.name;
  existingUser.email_verified = true;
  existingUser.reset_token = undefined;
  existingUser.reset_token_expires = undefined;
  await existingUser.save();

  console.log('ADMIN_BOOTSTRAP_RESET: admin reset');
};

module.exports = {
  bootstrapAdminUser
};
