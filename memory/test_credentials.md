# Test Credentials

## Admin
- Email: admin@peekaboo.com
- Password: admin123
- Role: admin
- Bootstrapped via: node-app User model (bcrypt hash, role="admin", email_verified=true)

## Notes
- The DB starts empty. If tests fail with "Invalid credentials", recreate the
  admin via:
    cd /app/backend/node-app && node -e "..." (see git history for snippet)
- Backend stack: Node/Express at port 8002 proxied through FastAPI/uvicorn at 8001.
  `cd /app/backend/node-app && yarn install` is required after a fresh clone.
- WhatsApp config (ACCESS_TOKEN, PHONE_NUMBER_ID) NOT set in dev — sends will
  fail with 'missing_config' which is expected.
