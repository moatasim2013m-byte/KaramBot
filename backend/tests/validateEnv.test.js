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

  describe('AI_PROVIDER=anthropic and AI_FALLBACK_PROVIDER', () => {
    function run(env) {
      const { validateEnv } = require('../src/config/validateEnv');
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      Object.assign(process.env, env);
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
      let exited = false;
      try {
        validateEnv();
      } catch (e) {
        exited = e.message === 'exit';
      }
      const warned = warnSpy.mock.calls.map((a) => a.join(' ')).join('\n');
      const errored = errSpy.mock.calls.map((a) => a.join(' ')).join('\n');
      [warnSpy, errSpy, logSpy, exitSpy].forEach((s) => s.mockRestore());
      return { exited, warned, errored };
    }

    test('anthropic is a known provider; its key is required in production', () => {
      const r = run({ NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: undefined,
        META_APP_SECRET: 'x', CORS_ORIGINS: 'x', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) });
      expect(r.exited).toBe(true);
      expect(r.errored).toContain('ANTHROPIC_API_KEY (required for AI_PROVIDER=anthropic)');
      expect(r.warned).not.toContain('Unknown AI_PROVIDER');
    });

    test('anthropic with its key passes in production', () => {
      const r = run({ NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-x',
        META_APP_SECRET: 'x', CORS_ORIGINS: 'x', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) });
      expect(r.exited).toBe(false);
    });

    test('a fallback without its key only warns, even in production', () => {
      const r = run({ NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-x', AI_FALLBACK_PROVIDER: 'gemini',
        GEMINI_API_KEY: undefined, META_APP_SECRET: 'x', CORS_ORIGINS: 'x', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) });
      expect(r.exited).toBe(false);
      expect(r.warned).toContain('GEMINI_API_KEY is not set — AI_FALLBACK_PROVIDER=gemini is disabled');
    });

    test('an unknown or same-as-primary fallback warns', () => {
      expect(run({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'claude' }).warned).toContain('Unknown AI_FALLBACK_PROVIDER="claude"');
      expect(run({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'gemini' }).warned).toContain('equals AI_PROVIDER');
    });
  });
});
