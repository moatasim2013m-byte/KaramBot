/**
 * Seed script to initialise Peekaboo's core data:
 *   - Play area pricing (Settings)
 *   - WhatsApp hours & location (Settings)
 *   - Daycare packages (SubscriptionPlan)
 *   - Birthday packages (Theme, package_type='birthday')
 *
 * Usage:
 *   MONGO_URL=... node seeds/seedPeekabooData.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/peekaboo';
const DB_NAME = process.env.DB_NAME;

const Settings = require('../models/Settings');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Theme = require('../models/Theme');

async function upsertSetting(key, value) {
  await Settings.findOneAndUpdate(
    { key },
    { key, value, updated_at: new Date() },
    { upsert: true, new: true }
  );
  console.log(`  ✓ Setting "${key}" = ${JSON.stringify(value)}`);
}

async function seedSettings() {
  console.log('\n[Settings] Seeding play pricing, hours & location…');

  const settingsData = [
    { key: 'hourly_1hr',          value: 7  },
    { key: 'hourly_2hr',          value: 10 },
    { key: 'hourly_3hr',          value: 13 },
    { key: 'hourly_extra_hr',     value: 3  },
    { key: 'extra_companion',     value: 3  },
    { key: 'sand_area_addon',     value: 20 },
    { key: 'transport_one_way',   value: 40 },
    {
      key: 'whatsapp_hours',
      value: 'الأحد-الخميس: 10:00 ص - 11:00 م، الجمعة-السبت: 10:00 ص - 12:00 ص'
    },
    {
      key: 'whatsapp_location',
      value: 'إربد - شارع أبو راشد، مجمع السيف التجاري، الطابق الثاني، بجانب وحشة سنتر'
    }
  ];

  for (const item of settingsData) {
    await upsertSetting(item.key, item.value);
  }
}

async function seedDaycarePackages() {
  console.log('\n[SubscriptionPlan] Seeding daycare packages…');

  const packages = [
    {
      name: 'Employee Half Day',
      name_ar: 'الموظفات - نصف يوم',
      description: 'Half day daycare for working parents',
      description_ar: 'رعاية نصف يوم للوالدين العاملين',
      price: 149,
      visits: 1,
      duration_hours: 6,
      duration_minutes: 0,
      includes: ['daycare', 'sand_area'],
      time_slots: ['7am-1pm', '1pm-7pm'],
      is_daily_pass: true,
      is_active: true
    },
    {
      name: 'Employee Full Day',
      name_ar: 'الموظفات - يوم كامل',
      description: 'Full day daycare for working parents',
      description_ar: 'رعاية يوم كامل للوالدين العاملين',
      price: 199,
      visits: 1,
      duration_hours: 12,
      duration_minutes: 0,
      includes: ['daycare', 'sand_area'],
      time_slots: ['7am-7pm'],
      is_daily_pass: true,
      is_active: true
    },
    {
      name: 'Premium Full Day',
      name_ar: 'اشتراك شامل - يوم كامل',
      description: 'Full day daycare with play area and sand zone included',
      description_ar: 'رعاية يوم كامل مع منطقة الألعاب والرمل',
      price: 250,
      visits: 1,
      duration_hours: 12,
      duration_minutes: 0,
      includes: ['daycare', 'play_area', 'sand_area'],
      time_slots: ['7am-7pm'],
      is_daily_pass: true,
      is_active: true
    }
  ];

  for (const pkg of packages) {
    const existing = await SubscriptionPlan.findOne({ name: pkg.name });
    if (existing) {
      await SubscriptionPlan.findByIdAndUpdate(existing._id, pkg);
      console.log(`  ✓ Updated daycare package "${pkg.name_ar}"`);
    } else {
      await SubscriptionPlan.create(pkg);
      console.log(`  ✓ Created daycare package "${pkg.name_ar}"`);
    }
  }
}

async function seedBirthdayPackages() {
  console.log('\n[Theme] Seeding birthday packages…');

  const packages = [
    {
      name: 'Basic Birthday',
      name_ar: 'Basic',
      description: 'Basic birthday party package',
      description_ar: 'باقة عيد ميلاد أساسية',
      price: 90,
      package_type: 'birthday',
      includes: {
        kids_count: 10,
        play_hours: 2,
        meals: 10,
        stands: 0,
        gifts_per_kid: false,
        premium_gift: false
      },
      is_active: true
    },
    {
      name: 'VIP Birthday',
      name_ar: 'VIP',
      description: 'VIP birthday party package with printed stand',
      description_ar: 'باقة عيد ميلاد VIP مع ستاند مطبوع',
      price: 150,
      package_type: 'birthday',
      includes: {
        kids_count: 15,
        play_hours: 2,
        meals: 15,
        stands: 1,
        gifts_per_kid: false,
        premium_gift: false
      },
      is_active: true
    },
    {
      name: 'Premium Birthday',
      name_ar: 'Premium',
      description: 'Premium birthday package with gifts and special gift for the birthday child',
      description_ar: 'باقة عيد ميلاد مميزة مع هدايا وهدية خاصة للمحتفى بها',
      price: 250,
      package_type: 'birthday',
      includes: {
        kids_count: 20,
        play_hours: 3,
        meals: 20,
        stands: 1,
        gifts_per_kid: true,
        premium_gift: true
      },
      is_active: true
    }
  ];

  for (const pkg of packages) {
    const existing = await Theme.findOne({ name: pkg.name, package_type: 'birthday' });
    if (existing) {
      await Theme.findByIdAndUpdate(existing._id, pkg);
      console.log(`  ✓ Updated birthday package "${pkg.name_ar}"`);
    } else {
      await Theme.create(pkg);
      console.log(`  ✓ Created birthday package "${pkg.name_ar}"`);
    }
  }
}

async function run() {
  const connOptions = DB_NAME ? { dbName: DB_NAME } : {};
  await mongoose.connect(MONGO_URL, connOptions);
  console.log('Connected to MongoDB');

  await seedSettings();
  await seedDaycarePackages();
  await seedBirthdayPackages();

  console.log('\n✅ Seed complete!\n');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
