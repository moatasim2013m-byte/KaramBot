# Test Credentials

## Admin
- Email: admin@peekaboo.com
- Password: admin123
- Role: admin
- Bootstrapped via: node-app User model (bcrypt hash on `password_hash` field, role="admin", email_verified=true)

## Notes
- The DB starts empty. If tests fail with "Invalid credentials", recreate the
  admin via:
    cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
      const mongoose=require('mongoose'); const bcrypt=require('bcryptjs'); const User=require('./models/User');
      (async()=>{ await mongoose.connect(process.env.MONGO_URL);
        const h=await bcrypt.hash('admin123',10);
        const e=await User.findOne({email:'admin@peekaboo.com'});
        if(e){ e.password_hash=h; e.role='admin'; e.email_verified=true; await e.save(); }
        else { await User.create({email:'admin@peekaboo.com',password_hash:h,name:'Admin',role:'admin',email_verified:true,phone:'962790000000'}); }
        await mongoose.disconnect(); })();"
- Backend stack: Node/Express at port 8002 proxied through FastAPI/uvicorn at 8001.
  `cd /app/backend/node-app && yarn install` is required after a fresh clone.
- WhatsApp config (ACCESS_TOKEN, PHONE_NUMBER_ID) NOT set in dev — sends will
  fail with 'whatsapp_not_configured' which is expected.
