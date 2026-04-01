require('dotenv').config({ path: '../../.env' });
const mongoose = require('mongoose');
const QuickReply = require('../models/QuickReply');
const User = require('../models/User');

const defaultQuickReplies = [
  {
    label: 'Greeting - Welcome',
    message: 'أهلاً وسهلاً! كيف يمكنني مساعدتك اليوم؟ 😊',
    category: 'greeting',
    platform: 'whatsapp'
  },
  {
    label: 'Hours - Working Hours',
    message: 'مواعيد العمل:\nالسبت - الخميس: 9:00 صباحاً - 8:00 مساءً\nالجمعة: 2:00 ظهراً - 8:00 مساءً',
    category: 'inquiry',
    platform: 'whatsapp'
  },
  {
    label: 'Booking - Available Today',
    message: 'يتوفر لدينا أماكن اليوم! هل تود الحجز؟ يمكنك الحجز عبر موقعنا: peekaboojor.com',
    category: 'booking',
    platform: 'whatsapp'
  },
  {
    label: 'Booking - Fully Booked',
    message: 'للأسف الأماكن محجوزة بالكامل اليوم. هل تود الحجز ليوم آخر؟',
    category: 'booking',
    platform: 'whatsapp'
  },
  {
    label: 'Payment - Confirmation',
    message: 'تم استلام دفعتك بنجاح! شكراً لك. حجزك مؤكد 🎉',
    category: 'payment',
    platform: 'whatsapp'
  },
  {
    label: 'Location - Address',
    message: '📍 العنوان: عمان، الأردن\nللاستفسارات: 📞 06-XXXXXXX',
    category: 'inquiry',
    platform: 'whatsapp'
  },
  {
    label: 'Birthday - Packages Info',
    message: 'باقات أعياد الميلاد تبدأ من 150 دينار وتشمل:\n• قاعة خاصة لمدة ساعتين\n• تزيين الثيم\n• كيك وحلويات\n• مشروبات للأطفال\n\nللتفاصيل والحجز: peekaboojor.com/birthday',
    category: 'inquiry',
    platform: 'whatsapp'
  },
  {
    label: 'Closing - Thank You',
    message: 'شكراً لتواصلك معنا! نسعد بخدمتك دائماً 💛',
    category: 'closing',
    platform: 'whatsapp'
  },
  {
    label: 'Info - Age Range',
    message: 'بيكابو مناسب للأطفال من عمر سنة إلى 10 سنوات 🎈',
    category: 'inquiry',
    platform: 'whatsapp'
  },
  {
    label: 'Info - What to Bring',
    message: 'يُرجى إحضار:\n• الجوارب (إلزامي)\n• ملابس مريحة للعب\n• زجاجة ماء (اختياري)',
    category: 'inquiry',
    platform: 'whatsapp'
  }
];

async function seedQuickReplies() {
  try {
    console.log('Connecting to MongoDB...');
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/peekaboo';
    console.log('Using MongoDB URL:', mongoUrl);
    await mongoose.connect(mongoUrl);
    console.log('Connected to MongoDB');

    // Find an admin/staff user
    let adminUser = await User.findOne({ role: { $in: ['admin', 'staff'] } });
    
    if (!adminUser) {
      console.log('No admin/staff user found. Please create at least one admin user first.');
      await mongoose.connection.close();
      process.exit(1);
    }

    console.log(`Using staff ID: ${adminUser._id}`);

    // Check if quick replies already exist
    const existingCount = await QuickReply.countDocuments();
    if (existingCount > 0) {
      console.log(`Quick replies already exist (${existingCount} found). Skipping seed.`);
      console.log('To re-seed, delete existing quick replies first.');
      await mongoose.connection.close();
      return;
    }

    // Create quick replies
    console.log('Creating default quick replies...');
    const replies = defaultQuickReplies.map((reply, index) => ({
      ...reply,
      created_by_staff_id: adminUser._id,
      sort_order: index + 1
    }));

    await QuickReply.insertMany(replies);
    console.log(`✅ Created ${replies.length} quick reply templates`);

    await mongoose.connection.close();
    console.log('Done!');
  } catch (error) {
    console.error('Error seeding quick replies:', error);
    process.exit(1);
  }
}

seedQuickReplies();
