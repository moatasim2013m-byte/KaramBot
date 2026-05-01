const mongoose = require('mongoose');
const HB = require('./models/HourlyBooking');
const Slot = require('./models/TimeSlot');
const User = require('./models/User');
const Child = require('./models/Child');
const QRCode = require('qrcode');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/peekaboo');
    
    const u = await User.findOne({ role: 'parent' });
    if (!u) {
      console.error('NO PARENT');
      process.exit(1);
    }
    
    let c = await Child.findOne({ parent_id: u._id });
    if (!c) {
      c = await Child.create({
        parent_id: u._id,
        name: 'QA Kid',
        birthday: new Date('2020-01-01')
      });
    }
    
    // Create a slot for today if none exists
    let s = await Slot.findOne({});
    if (!s) {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
      s = await Slot.create({
        date: dateStr,
        start_time: '10:00',
        slot_type: 'hourly',
        capacity: 20,
        booked_count: 0
      });
    }
    
    const mk = async (method, payStatus, codeSuffix) => {
      const qrToken = 'qa-qr-' + codeSuffix + '-' + Date.now();
      const qrCode = await QRCode.toDataURL(qrToken);
      
      return await HB.create({
        user_id: u._id,
        child_id: c._id,
        slot_id: s._id,
        booking_code: 'QA-' + codeSuffix + '-' + Date.now(),
        status: 'confirmed',
        payment_method: method,
        payment_status: payStatus,
        amount: 10,
        duration_hours: 2,
        qr_code: qrCode,
        qr_token: qrToken
      });
    };
    
    const cashB = await mk('cash', 'pending_cash', 'CASH');
    const cliqB = await mk('cliq', 'pending_cliq', 'CLIQ');
    const paidB = await mk('cash', 'paid', 'PAID');
    
    console.log(JSON.stringify({
      cash: { id: cashB._id.toString(), code: cashB.booking_code, qr: cashB.qr_token },
      cliq: { id: cliqB._id.toString(), code: cliqB.booking_code, qr: cliqB.qr_token },
      paid: { id: paidB._id.toString(), code: paidB.booking_code, qr: paidB.qr_token }
    }, null, 2));
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
