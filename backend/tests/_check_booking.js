// Helper: read a HourlyBooking document by booking_code and dump key fields.
// Usage: node tests/_check_booking.js <booking_code>
require('dotenv').config({ path: '/app/backend/.env' });
const mongoose = require('/app/backend/node-app/node_modules/mongoose');
const HourlyBooking = require('/app/backend/node-app/models/HourlyBooking');

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
