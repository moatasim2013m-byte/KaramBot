/**
 * Seed Script - Demo Arabic Restaurant
 * Usage: node scripts/seed.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../src/utils/tokenCrypto');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is required. Set it in backend/.env');
  process.exit(1);
}
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  console.error('❌ TOKEN_ENCRYPTION_KEY is required. Cannot encrypt demo WhatsApp token.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding database...');

  // Cleanup existing demo data
  const existingBiz = await prisma.business.findFirst({ where: { slug: 'demo-restaurant' } });
  if (existingBiz) {
    await prisma.menuItem.deleteMany({ where: { business_id: existingBiz.id } });
    await prisma.category.deleteMany({ where: { business_id: existingBiz.id } });
    await prisma.user.deleteMany({ where: { business_id: existingBiz.id } });
    await prisma.business.delete({ where: { id: existingBiz.id } });
    console.log('🗑️  Removed existing demo data');
  }

  // ─── Create Business ──────────────────────────────────────────────────────────
  const demoWaAccessToken = process.env.DEMO_WA_ACCESS_TOKEN || 'DEMO_TOKEN';
  const business = await prisma.business.create({
    data: {
      name: 'مطعم الأصيل',
      slug: 'demo-restaurant',
      business_type: 'restaurant',
      language_default: 'ar',
      timezone: 'Asia/Amman',
      currency: 'JOD',
      address: 'عمان، الأردن',
      wa_phone_number_id: process.env.DEMO_WA_PHONE_NUMBER_ID || '123456789',
      wa_business_account_id: process.env.DEMO_WA_BUSINESS_ACCOUNT_ID || '987654321',
      wa_access_token: encrypt(demoWaAccessToken),
      opening_hours: [
        { day: 0, open: '11:00', close: '23:00' },
        { day: 1, open: '11:00', close: '23:00' },
        { day: 2, open: '11:00', close: '23:00' },
        { day: 3, open: '11:00', close: '23:00' },
        { day: 4, open: '11:00', close: '00:00' },
        { day: 5, open: '12:00', close: '01:00' },
        { day: 6, open: '12:00', close: '01:00' },
      ],
      ai_config: {
        enabled: true,
        provider: 'gemini',
        personality: 'مساعد ودود ومتحمس لتقديم أفضل الأطباق العربية الأصيلة',
        greeting_message: 'أهلاً وسهلاً في مطعم الأصيل! 🍽️\nكيف أقدر أساعدك اليوم؟\nيمكنك مشاهدة قائمتنا أو تسجيل طلبك مباشرة.',
        fallback_message: 'سأحولك إلى أحد موظفينا الآن. انتظر لحظة من فضلك.',
        handoff_keywords: ['موظف', 'انسان', 'مدير', 'مشكلة', 'شكوى'],
        out_of_hours_message: 'مطعم الأصيل مغلق حالياً. أوقات العمل: 11 صباحاً - 11 مساءً. سنرد عليك قريباً! ��',
      },
      policies: {
        delivery_fee: 1.5,
        min_order_amount: 5,
        payment_methods: ['cash', 'cliq'],
        order_confirmation_message: 'شكراً لطلبك! سيتم تحضيره والتواصل معك قريباً. 🍽️',
        delivery_policy: 'التوصيل داخل عمان خلال 30-45 دقيقة.',
      },
      status: 'active',
    },
  });
  console.log(`✅ Business created: ${business.name} (${business.id})`);

  // ─── Categories ───────────────────────────────────────────────────────────────
  const [catMezze, catGrills, catSandwiches, catSides, catDrinks, catDesserts] = await Promise.all([
    prisma.category.create({ data: { business_id: business.id, name_ar: 'مقبلات', name_en: 'Mezze', sort_order: 1 } }),
    prisma.category.create({ data: { business_id: business.id, name_ar: 'مشاوي', name_en: 'Grills', sort_order: 2 } }),
    prisma.category.create({ data: { business_id: business.id, name_ar: 'سندويشات', name_en: 'Sandwiches', sort_order: 3 } }),
    prisma.category.create({ data: { business_id: business.id, name_ar: 'أطباق جانبية', name_en: 'Sides', sort_order: 4 } }),
    prisma.category.create({ data: { business_id: business.id, name_ar: 'مشروبات', name_en: 'Drinks', sort_order: 5 } }),
    prisma.category.create({ data: { business_id: business.id, name_ar: 'حلويات', name_en: 'Desserts', sort_order: 6 } }),
  ]);
  console.log('✅ Categories created');

  // ─── Menu Items ────────────────────────────────────────────────────────────────
  const menuItems = [
    // Mezze
    { business_id: business.id, category_id: catMezze.id, name_ar: 'حمص بالطحينة', name_en: 'Hummus', price: 2.5, description_ar: 'حمص طازج بزيت الزيتون والطحينة', sort_order: 1 },
    { business_id: business.id, category_id: catMezze.id, name_ar: 'متبل باذنجان', name_en: 'Mutabbal', price: 2.5, description_ar: 'باذنجان مشوي بالطحينة والثوم', sort_order: 2 },
    { business_id: business.id, category_id: catMezze.id, name_ar: 'سلطة فتوش', name_en: 'Fattoush', price: 2.0, description_ar: 'خضار طازجة مع خبز محمص وصلصة الرمان', sort_order: 3 },
    { business_id: business.id, category_id: catMezze.id, name_ar: 'ورق عنب', name_en: 'Stuffed Vine Leaves', price: 3.0, description_ar: 'ورق عنب محشو بالأرز واللحم', sort_order: 4 },
    // Grills
    { business_id: business.id, category_id: catGrills.id, name_ar: 'مشاوي مشكلة', name_en: 'Mixed Grill', price: 12.0, description_ar: 'تشكيلة من الكباب والشيش والدجاج المشوي', sort_order: 1 },
    { business_id: business.id, category_id: catGrills.id, name_ar: 'كباب لحم', name_en: 'Lamb Kofta', price: 7.0, description_ar: 'كباب لحم ضاني مشوي على الفحم', sort_order: 2 },
    { business_id: business.id, category_id: catGrills.id, name_ar: 'شيش طاووق', name_en: 'Shish Tawook', price: 7.0, description_ar: 'دجاج متبل مشوي على الفحم', sort_order: 3 },
    { business_id: business.id, category_id: catGrills.id, name_ar: 'ضلوع لحم', name_en: 'Lamb Ribs', price: 14.0, description_ar: 'ضلوع لحم ضاني مشوية ببهارات الشرق', sort_order: 4 },
    // Sandwiches
    { business_id: business.id, category_id: catSandwiches.id, name_ar: 'شاورما دجاج', name_en: 'Chicken Shawarma', price: 2.5, description_ar: 'شاورما دجاج بالصوص والمخللات', sort_order: 1 },
    { business_id: business.id, category_id: catSandwiches.id, name_ar: 'شاورما لحم', name_en: 'Meat Shawarma', price: 3.0, description_ar: 'شاورما لحم بالطحينة والبقدونس', sort_order: 2 },
    { business_id: business.id, category_id: catSandwiches.id, name_ar: 'فلافل', name_en: 'Falafel', price: 1.5, description_ar: 'فلافل مقرمشة بالطحينة والخضار', sort_order: 3 },
    // Sides
    { business_id: business.id, category_id: catSides.id, name_ar: 'أرز بالشعيرية', name_en: 'Rice', price: 1.5, sort_order: 1 },
    { business_id: business.id, category_id: catSides.id, name_ar: 'خبز تنور', name_en: 'Bread', price: 0.5, sort_order: 2 },
    { business_id: business.id, category_id: catSides.id, name_ar: 'مخللات', name_en: 'Pickles', price: 1.0, sort_order: 3 },
    { business_id: business.id, category_id: catSides.id, name_ar: 'بطاطا مقلية', name_en: 'French Fries', price: 2.0, sort_order: 4 },
    // Drinks
    { business_id: business.id, category_id: catDrinks.id, name_ar: 'عصير ليمون بالنعناع', name_en: 'Lemonade', price: 2.0, sort_order: 1 },
    { business_id: business.id, category_id: catDrinks.id, name_ar: 'آيس تي', name_en: 'Iced Tea', price: 1.5, sort_order: 2 },
    { business_id: business.id, category_id: catDrinks.id, name_ar: 'مياه معدنية', name_en: 'Water', price: 0.5, sort_order: 3 },
    { business_id: business.id, category_id: catDrinks.id, name_ar: 'عصير طازج', name_en: 'Fresh Juice', price: 2.5, sort_order: 4 },
    // Desserts
    { business_id: business.id, category_id: catDesserts.id, name_ar: 'كنافة نابلسية', name_en: 'Kunafa', price: 3.0, description_ar: 'كنافة بالجبنة والقطر العثماني', sort_order: 1 },
    { business_id: business.id, category_id: catDesserts.id, name_ar: 'أم علي', name_en: 'Om Ali', price: 2.5, description_ar: 'حلوى مصرية بالقشطة والمكسرات', sort_order: 2 },
    { business_id: business.id, category_id: catDesserts.id, name_ar: 'قطايف', name_en: 'Qatayef', price: 2.0, sort_order: 3 },
  ];

  for (const item of menuItems) {
    await prisma.menuItem.create({ data: item });
  }
  console.log('✅ Menu items created');

  // ─── Users ─────────────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin@123', 12);
  const ownerHash = await bcrypt.hash('Owner@123', 12);
  const staffHash = await bcrypt.hash('Staff@123', 12);

  await prisma.user.createMany({
    data: [
      { name: 'Admin النظام', email: 'admin@demo.com', password: adminHash, role: 'platform_admin', business_id: null },
      { name: 'صاحب المطعم', email: 'owner@demo.com', password: ownerHash, role: 'business_owner', business_id: business.id },
      { name: 'موظف الاستقبال', email: 'staff@demo.com', password: staffHash, role: 'staff', business_id: business.id },
    ],
  });
  console.log('✅ Users created');

  console.log('\n🎉 Seed complete!\n');
  console.log('Login credentials:');
  console.log('  Platform Admin: admin@demo.com / Admin@123');
  console.log('  Business Owner: owner@demo.com / Owner@123');
  console.log('  Staff:          staff@demo.com / Staff@123');
  console.log(`\nBusiness ID: ${business.id}`);

  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
