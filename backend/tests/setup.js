/**
 * Test setup: uses in-memory MongoDB so tests never hit a real database.
 * Requires: npm install --save-dev @mongomemoryserver/mongodb-memory-server
 *
 * Since we don't want to add that dependency, we mock mongoose instead.
 * Tests use supertest against the Express app directly.
 */

// Set test environment vars before anything else loads
process.env.NODE_ENV = 'test';
process.env.MONGO_URL = 'mongodb://localhost:27017/test';
process.env.DB_NAME = 'karambot_test';
process.env.JWT_SECRET = 'test_secret_that_is_long_enough_for_tests_32chars';
process.env.META_APP_SECRET = 'test_meta_secret';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test_verify_token';
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test_gemini_key';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.FRONTEND_URL = 'http://localhost:5173';
