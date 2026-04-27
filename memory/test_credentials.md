# Test Credentials

## Admin
- Email: admin@peekaboo.com
- Password: admin123
- Role: admin
- Bootstrapped via: node-app User model (bcrypt hash on `password_hash` field, role="admin", email_verified=true)

## Parent (for /profile testing — admin gets redirected to /admin)
- Email: parent@peekaboo.com
- Password: parent123
- Role: parent
- Phone: 962790111111

## Recreate (if /api/auth/login returns 'Invalid credentials' on a fresh DB):
```bash
cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
  const mongoose=require('mongoose'); const bcrypt=require('bcryptjs'); const User=require('./models/User');
  (async()=>{ await mongoose.connect(process.env.MONGO_URL);
    for (const [email, role, name, phone] of [
      ['admin@peekaboo.com','admin','Admin','962790000000'],
      ['parent@peekaboo.com','parent','Test Parent','962790111111'],
    ]) {
      const h = await bcrypt.hash(role+'123', 10);
      const e = await User.findOne({email});
      if (e) { e.password_hash=h; e.role=role; e.email_verified=true; await e.save(); }
      else { await User.create({email,password_hash:h,name,role,email_verified:true,phone}); }
    }
    await mongoose.disconnect(); })();"
```

## Notes
- Backend stack: Node/Express at port 8002 proxied through FastAPI/uvicorn at 8001.
  `cd /app/backend/node-app && yarn install` is required after a fresh clone.
- WhatsApp config (ACCESS_TOKEN, PHONE_NUMBER_ID) NOT set in dev — sends will
  fail with 'whatsapp_not_configured' which is expected.
- ProfilePage redirects users with role==='admin' to /admin. Use the parent
  account for any /profile tests.
- StaffPage requires role in ['staff','admin']. The admin account works.
