process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/karambot_test';
process.env.JWT_SECRET = 'test_secret_that_is_long_enough_for_tests_32chars';
process.env.META_APP_SECRET = 'test_meta_secret';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test_verify_token';
process.env.SHIFT_WEBHOOK_VERIFY_TOKEN = 'test_shift_verify_token';
process.env.SHIFT_ES_APP_SECRET = 'test_shift_app_secret';
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.AI_PROVIDER = 'gemini';
// The deadline-mode tests describe the attempt schedule in 15 s steps; production's default is 25 s
// (Opus 5.5 thinks before answering) and is checked in providerDeadlineDefaults.test.js.
process.env.SHIFT_AI_FIRST_ATTEMPT_MS = '15000';
process.env.GEMINI_API_KEY = 'test_gemini_key';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.FRONTEND_URL = 'http://localhost:5173';
