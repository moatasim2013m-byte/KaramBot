require('./setup');
const { encrypt, decrypt } = require('../src/utils/tokenCrypto');

describe('Token Encryption', () => {

  test('encrypts and decrypts a token correctly', () => {
    const token = 'EAABsbCS1iHgBOtest_whatsapp_token_12345';
    const encrypted = encrypt(token);

    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toBe(token);
    expect(encrypted.split(':').length).toBe(3); // iv:tag:ciphertext

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(token);
  });

  test('each encryption produces a different ciphertext (random IV)', () => {
    const token = 'same_token_value';
    const enc1 = encrypt(token);
    const enc2 = encrypt(token);
    expect(enc1).not.toBe(enc2); // IVs differ
    expect(decrypt(enc1)).toBe(token);
    expect(decrypt(enc2)).toBe(token);
  });

  test('encrypting null returns null', () => {
    expect(encrypt(null)).toBeNull();
  });

  test('decrypting null returns null', () => {
    expect(decrypt(null)).toBeNull();
  });

  test('decrypting a plain (unencrypted) token warns and returns it as-is', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const plain = 'EAABsbCS1iHgBO_plain_legacy_token';
    const result = decrypt(plain);
    expect(result).toBe(plain);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unencrypted'));
    consoleSpy.mockRestore();
  });

  test('throws on tampered ciphertext', () => {
    const token = 'EAAtest';
    const encrypted = encrypt(token);
    const parts = encrypted.split(':');
    parts[2] = Buffer.from('tampered').toString('base64');
    const tampered = parts.join(':');
    expect(() => decrypt(tampered)).toThrow();
  });
});
