/**
 * Token encryption utility.
 *
 * Uses AES-256-GCM (authenticated encryption).
 * Requires TOKEN_ENCRYPTION_KEY env var: 64 hex characters (32 bytes).
 *
 * Generate a key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

function getKey() {
  const hexKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set. Cannot encrypt/decrypt WhatsApp tokens.');
  }
  if (hexKey.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns a base64 string: iv:tag:ciphertext
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv):base64(tag):base64(ciphertext)
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt an encrypted token string produced by encrypt().
 * Returns plaintext or throws on failure.
 */
function decrypt(encryptedStr) {
  if (!encryptedStr) return null;

  // Support legacy plain tokens (not yet encrypted) — detect by missing ':' format
  // Plain WhatsApp tokens typically start with "EAA" or similar; never contain exactly 2 colons
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) {
    // Likely a plain token from before encryption was added
    console.warn('⚠️  wa_access_token appears unencrypted. Re-save via PATCH /api/businesses/:id/token to encrypt.');
    return encryptedStr;
  }

  try {
    const key = getKey();
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`Failed to decrypt WhatsApp token: ${err.message}`);
  }
}

module.exports = { encrypt, decrypt };
