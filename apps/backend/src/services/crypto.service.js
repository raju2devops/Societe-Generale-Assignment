/**
 * Cryptography service - application-level field encryption, blind indexes,
 * password hashing and CSPRNG token generation.
 *
 * Mandatory Controls: "Encrypt sensitive data at rest", "Avoid weak encryption
 * algorithms" (AES-256 / RSA-2048+ / TLS 1.3 only), "Secure password storage"
 * (bcrypt/scrypt with a unique salt), "Cryptoagility".
 * OWASP A04:2025 Cryptographic Failures.
 *
 * Design notes
 * ------------
 * * Field encryption uses **AES-256-GCM** (authenticated encryption). A random
 *   96-bit IV is generated per value; the auth tag is stored alongside. The
 *   stored envelope is `v1.<keyId>.<iv>.<tag>.<ciphertext>` (all base64url), so
 *   the key can be rotated without a schema change - decrypt reads the keyId
 *   from the envelope (cryptoagility).
 * * Values that must remain *searchable* (account number, e-mail) additionally
 *   get a **blind index**: `HMAC-SHA256(normalisedValue, BLIND_INDEX_KEY)`.
 *   The index is deterministic so it can carry a unique constraint, but it is
 *   keyed, so a database dump alone cannot be brute-forced without the key,
 *   which lives in Azure Key Vault and never in the database.
 * * Passwords use Node's built-in **scrypt** (N=2^15, r=8, p=2, 64-byte key,
 *   16-byte unique random salt). scrypt is explicitly permitted by the sc
 *   controls and, being part of the Node standard library, adds zero
 *   supply-chain surface (OWASP A03:2025).
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config/env.js';

const scrypt = promisify(crypto.scrypt);

const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12; // 96-bit IV, the GCM-recommended size
const SCRYPT_PARAMS = Object.freeze({ N: 32768, r: 8, p: 2, keylen: 64, maxmem: 96 * 1024 * 1024 });

/** Key ring keyed by keyId - lets old ciphertext stay readable after rotation. */
const keyRing = new Map([[config.crypto.fieldEncKeyId, config.crypto.fieldEncKey]]);

const b64u = (buf) => buf.toString('base64url');
const unb64u = (str) => Buffer.from(str, 'base64url');

/**
 * Encrypt a single field value.
 * @param {string|null|undefined} plaintext
 * @returns {string|null} envelope string, or null for empty input
 */
export function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const keyId = config.crypto.fieldEncKeyId;
  const key = keyRing.get(keyId);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  // Bind the ciphertext to its key id so an attacker cannot swap envelopes
  // between key generations without breaking the auth tag.
  cipher.setAAD(Buffer.from(`${ENVELOPE_VERSION}.${keyId}`, 'utf8'));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, keyId, b64u(iv), b64u(tag), b64u(ct)].join('.');
}

/**
 * Decrypt a field envelope produced by {@link encryptField}.
 * Throws on tamper (GCM auth-tag mismatch) - we never return partial plaintext.
 */
export function decryptField(envelope) {
  if (envelope === null || envelope === undefined || envelope === '') return null;
  const parts = String(envelope).split('.');
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Malformed ciphertext envelope');
  }
  const [, keyId, ivB64, tagB64, ctB64] = parts;
  const key = keyRing.get(keyId);
  if (!key) throw new Error(`Unknown field-encryption key id: ${keyId}`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64u(ivB64));
  decipher.setAAD(Buffer.from(`${ENVELOPE_VERSION}.${keyId}`, 'utf8'));
  decipher.setAuthTag(unb64u(tagB64));
  return Buffer.concat([decipher.update(unb64u(ctB64)), decipher.final()]).toString('utf8');
}

/**
 * Deterministic keyed index for equality lookups over encrypted columns.
 * @param {string} value
 * @param {string} domain - separates namespaces so the same value in two
 *                          different fields does not produce the same index.
 */
export function blindIndex(value, domain) {
  const normalised = String(value).trim().toLowerCase();
  return crypto
    .createHmac('sha256', config.crypto.blindIndexKey)
    .update(`${domain}:${normalised}`)
    .digest('hex');
}

/** Hash a password. Returns a self-describing string, never reversible. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    b64u(salt),
    b64u(derived),
  ].join('$');
}

/**
 * Verify a password in constant time.
 * Returns false (never throws) on a malformed stored hash, so a corrupted row
 * cannot be turned into an oracle - fail securely.
 */
export async function verifyPassword(password, stored) {
  try {
    if (!stored) return false;
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = unb64u(hashB64);
    const derived = await scrypt(password, unb64u(saltB64), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** CSPRNG token - never Math.random() (OWASP A04:2025). */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Non-reversible fingerprint used to store refresh tokens at rest. */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Constant-time string comparison for CSRF / token echo checks. */
export function timingSafeEquals(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a structurally valid 27-character French IBAN using the CSPRNG.
 *
 *   FR | check(2) | bank(5) | branch(5) | account(11) | RIB key(2)
 *
 * Both check systems are computed properly - the RIB key and the ISO 13616
 * mod-97 check digits - so the numbers survive any downstream IBAN validator
 * instead of failing in a payment gateway months later.
 *
 * Randomness comes from the CSPRNG, never Math.random(). Account numbers are
 * unguessable by design; they must never act as a security boundary on their
 * own (OWASP API1:2023 BOLA), but unpredictability removes the cheapest
 * enumeration path.
 */
export function generateAccountNumber({ countryCode = 'FR', bankCode = '30003' } = {}) {
  const branchCode = String(crypto.randomInt(0, 100000)).padStart(5, '0');
  const accountPart = String(crypto.randomInt(0, 10 ** 11)).padStart(11, '0');

  // French RIB key: 97 - ((89*bank + 15*branch + 3*account) mod 97)
  const ribKey = String(
    97 - ((89 * Number(bankCode) + 15 * Number(branchCode) + 3 * Number(accountPart)) % 97)
  ).padStart(2, '0');

  const bban = `${bankCode}${branchCode}${accountPart}${ribKey}`;
  const check = String(98 - mod97(`${bban}${letterToDigits(countryCode)}00`)).padStart(2, '0');
  return `${countryCode}${check}${bban}`;
}

function letterToDigits(letters) {
  return letters
    .toUpperCase()
    .split('')
    .map((ch) => (ch.charCodeAt(0) - 55).toString())
    .join('');
}

/** Iterative mod-97 so arbitrarily long IBAN strings never overflow a Number. */
function mod97(numericString) {
  let remainder = 0;
  for (const ch of numericString) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  return remainder;
}

export default {
  encryptField,
  decryptField,
  blindIndex,
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  timingSafeEquals,
  generateAccountNumber,
};
