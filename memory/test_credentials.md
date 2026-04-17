# Test Credentials

## Admin
- Email: admin@peekaboo.com
- Password: admin123
- Role: admin

## Notes
- Admin credentials from existing seed/bootstrap
- Backend runs on internal port 8002, proxied through FastAPI on 8001
- WhatsApp config (ACCESS_TOKEN, PHONE_NUMBER_ID) NOT set in dev - sends will fail with 'missing_config' which is expected
