// Helper: read a HourlyBooking by booking_code. Run from node-app dir.
require('dotenv').config({ path: '/app/backend/.env' });
const mongoose = require('mongoose');
const HourlyBooking = require('../models/HourlyBooking');

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const code = process.argv[2];
  const b = await HourlyBooking.findOne({ booking_code: code }).lean();
  if (!b) {
    console.log(JSON.stringify({ found: false }));
  } else {
    console.log(JSON.stringify({
      found: true,
      booking_code: b.booking_code,
      service_type: b.service_type || null,
      amount: b.amount,
      child_count: b.child_count,
      duration_hours: b.duration_hours,
    }));
  }
  await mongoose.disconnect();
})();
