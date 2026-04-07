const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

// Import models
const User = require('./models/User');
const Theme = require('./models/Theme');
const SubscriptionPlan = require('./models/SubscriptionPlan');
const Settings = require('./models/Settings');
const GalleryMedia = require('./models/GalleryMedia');
const bcrypt = require('bcryptjs');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, { dbName: process.env.DB_NAME });
    console.log('Connected to MongoDB');

    // Create Admin User (env-driven, no hardcoded credentials)
    const adminEmail = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
    const adminPasswordRaw = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
    const adminName = (process.env.ADMIN_BOOTSTRAP_NAME || '').trim() || 'Admin';

    if (adminEmail && adminPasswordRaw) {
      const adminExists = await User.findOne({ email: adminEmail });
      if (!adminExists) {
        const adminPassword = await bcrypt.hash(adminPasswordRaw, 10);
        await User.create({
          email: adminEmail,
          password_hash: adminPassword,
          name: adminName,
          role: 'admin',
          loyalty_points: 0,
          email_verified: true
        });
        console.log('Admin user created from environment configuration');
      } else {
        console.log('Admin seed skipped (admin user already exists)');
      }
    } else {
      console.log('Admin seed skipped (missing ADMIN_BOOTSTRAP_EMAIL/ADMIN_BOOTSTRAP_PASSWORD)');
    }

    // Create 10 Birthday Themes
    const themesCount = await Theme.countDocuments();
    if (themesCount === 0) {
      const themes = [
        { name: 'Superhero Adventure', description: 'Save the day with your favorite heroes! Includes capes, masks, and action-packed games.', price: 150.00, image_url: 'https://images.pexels.com/photos/6148511/pexels-photo-6148511.jpeg' },
        { name: 'Princess Castle', description: 'A royal celebration fit for royalty! Crowns, tiaras, and fairy tale decorations.', price: 150.00, image_url: 'https://images.pexels.com/photos/3951099/pexels-photo-3951099.png' },
        { name: 'Jungle Safari', description: 'Wild adventure in the jungle! Animal masks, safari props, and nature-themed games.', price: 120.00, image_url: 'https://images.pexels.com/photos/19875328/pexels-photo-19875328.jpeg' },
        { name: 'Under the Sea', description: 'Dive into an ocean of fun! Mermaids, fish, and underwater treasures.', price: 130.00, image_url: 'https://images.pexels.com/photos/6148511/pexels-photo-6148511.jpeg' },
        { name: 'Space Explorer', description: 'Blast off to the stars! Rockets, planets, and cosmic decorations.', price: 140.00, image_url: 'https://images.pexels.com/photos/3951099/pexels-photo-3951099.png' },
        { name: 'Dinosaur Discovery', description: 'Roar into fun! Dinosaur fossils, eggs, and prehistoric adventures.', price: 130.00, image_url: 'https://images.pexels.com/photos/19875328/pexels-photo-19875328.jpeg' },
        { name: 'Unicorn Dreams', description: 'Magical and sparkly! Rainbows, unicorns, and enchanted activities.', price: 140.00, image_url: 'https://images.pexels.com/photos/6148511/pexels-photo-6148511.jpeg' },
        { name: 'Sports Champion', description: 'Game on! Soccer, basketball, and all your favorite sports.', price: 120.00, image_url: 'https://images.pexels.com/photos/3951099/pexels-photo-3951099.png' },
        { name: 'Art Studio', description: 'Creative celebration! Painting, crafts, and artistic activities.', price: 135.00, image_url: 'https://images.pexels.com/photos/19875328/pexels-photo-19875328.jpeg' },
        { name: 'Pirate Treasure', description: 'Ahoy matey! Treasure hunts, pirate costumes, and swashbuckling fun.', price: 145.00, image_url: 'https://images.pexels.com/photos/6148511/pexels-photo-6148511.jpeg' }
      ];
      await Theme.insertMany(themes);
      console.log('10 Birthday themes created');
    }

    // Create 3 Subscription Plans
    const plansCount = await SubscriptionPlan.countDocuments();
    if (plansCount === 0) {
      const plans = [
        { 
          name: 'Visit Package - 8 Visits', 
          name_ar: 'باقة الزيارات - 8 زيارات',
          description: 'Perfect for regular visits', 
          description_ar: 'مثالية للزيارات المنتظمة',
          visits: 8, 
          price: 59.00 
        },
        { 
          name: 'Visit Package - 12 Visits', 
          name_ar: 'باقة الزيارات - 12 زيارة',
          description: 'Great value for frequent players', 
          description_ar: 'قيمة رائعة للزوار المتكررين',
          visits: 12, 
          price: 79.00 
        },
        { 
          name: 'Monthly Daily Pass (Sun-Thu)', 
          name_ar: 'باقة يومية شهرية (الأحد-الخميس)',
          description: 'Unlimited visits Sunday to Thursday', 
          description_ar: 'زيارات غير محدودة من الأحد إلى الخميس',
          visits: 999, 
          price: 120.00,
          is_daily_pass: true,
          valid_days: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']
        }
      ];
      await SubscriptionPlan.insertMany(plans);
      console.log('3 Subscription plans created');
    }

    // Create Default Settings
    const settingsCount = await Settings.countDocuments();
    if (settingsCount === 0) {
      const settings = [
        { key: 'hourly_1hr', value: 7 },
        { key: 'hourly_2hr', value: 10 },
        { key: 'hourly_3hr', value: 13 },
        { key: 'hourly_extra_hr', value: 3 },
        { key: 'hourly_capacity', value: 25 },
        { key: 'birthday_capacity', value: 1 }
      ];
      await Settings.insertMany(settings);
      console.log('Default settings created');
    }

    // Create Gallery Media
    const mediaCount = await GalleryMedia.countDocuments();
    if (mediaCount === 0) {
      const media = [
        { url: 'https://images.pexels.com/photos/19875328/pexels-photo-19875328.jpeg', type: 'photo', title: 'Kids Playing', order: 0 },
        { url: 'https://images.pexels.com/photos/6148511/pexels-photo-6148511.jpeg', type: 'photo', title: 'Birthday Party', order: 1 },
        { url: 'https://images.pexels.com/photos/3951099/pexels-photo-3951099.png', type: 'photo', title: 'Family Fun', order: 2 }
      ];
      await GalleryMedia.insertMany(media);
      console.log('Gallery media created');
    }

    console.log('Seed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
