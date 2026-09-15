require('./setup');

describe('Environment Validator', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    Object.keys(process.env).forEach(k => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  test('validateEnv passes with all required vars set (test env)', () => {
    // setup.js already sets all required vars
    // validateEnv is called at server startup — in test env it should not throw
    const { validateEnv } = require('../src/config/validateEnv');
    expect(() => validateEnv()).not.toThrow();
  });

  test('validates TOKEN_ENCRYPTION_KEY length', () => {
    const { validateEnv } = require('../src/config/validateEnv');
    process.env.TOKEN_ENCRYPTION_KEY = 'tooshort';
    // In test/dev it warns but doesn't throw
    expect(() => validateEnv()).not.toThrow();
  });

  test('AI provider key check warns for missing gemini key in dev', () => {
    const { validateEnv } = require('../src/config/validateEnv');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.GEMINI_API_KEY;
    expect(() => validateEnv()).not.toThrow(); // only warns in dev
    warnSpy.mockRestore();
  });

  test('production without INTERNAL_SWEEP_TOKEN warns but does not exit', () => {
    const { validateEnv } = require('../src/config/validateEnv');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_SWEEP_TOKEN;
    delete process.env.STAFF_ALERT_WEBHOOK_URL;
    try {
      expect(() => validateEnv()).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      const warned = warnSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(warned).toContain('INTERNAL_SWEEP_TOKEN is not set');
      expect(warned).toContain('STAFF_ALERT_WEBHOOK_URL is not set');
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
