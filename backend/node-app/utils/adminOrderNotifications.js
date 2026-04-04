const User = require('../models/User');
const { sendEmail } = require('./email');

const resolveRecipients = async () => {
  const configured = String(process.env.ORDER_ALERT_EMAILS || process.env.ADMIN_NOTIFICATION_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (configured.length > 0) {
    return [...new Set(configured)];
  }

  const admins = await User.find({ role: 'admin', is_disabled: { $ne: true } })
    .select('email')
    .lean();

  return [...new Set(admins.map((admin) => String(admin.email || '').trim().toLowerCase()).filter(Boolean))];
};

const notifyAdminsOfOrder = async ({
  orderType = 'Order',
  orderId = '-',
  customerName = '-',
  customerEmail = '-',
  amount = 0,
  paymentStatus = '-',
  createdAt = new Date()
} = {}) => {
  const recipients = await resolveRecipients();
  if (!recipients.length) return { sent: false, reason: 'no_recipients' };

  const subject = `New ${orderType} received | ${orderId}`;
  const createdLabel = new Date(createdAt).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;">
      <h2 style="margin:0 0 12px;color:#111827;">طلب جديد وصل الآن</h2>
      <p style="margin:0 0 16px;color:#374151;">New transaction has been created in Peekaboo.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px;border-bottom:1px solid #f3f4f6;"><strong>النوع</strong></td><td style="padding:8px;border-bottom:1px solid #f3f4f6;">${orderType}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #f3f4f6;"><strong>رقم الطلب</strong></td><td style="padding:8px;border-bottom:1px solid #f3f4f6;">${orderId}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #f3f4f6;"><strong>العميل</strong></td><td style="padding:8px;border-bottom:1px solid #f3f4f6;">${customerName}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #f3f4f6;"><strong>البريد</strong></td><td style="padding:8px;border-bottom:1px solid #f3f4f6;">${customerEmail}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #f3f4f6;"><strong>المبلغ</strong></td><td style="padding:8px;border-bottom:1px solid #f3f4f6;">${Number(amount || 0).toFixed(2)} JD</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #f3f4f6;"><strong>حالة الدفع</strong></td><td style="padding:8px;border-bottom:1px solid #f3f4f6;">${paymentStatus}</td></tr>
        <tr><td style="padding:8px;"><strong>وقت الاستلام</strong></td><td style="padding:8px;">${createdLabel}</td></tr>
      </table>
    </div>
  `;

  await Promise.allSettled(recipients.map((to) => sendEmail(to, subject, html)));
  return { sent: true, recipients: recipients.length };
};

module.exports = {
  notifyAdminsOfOrder
};
