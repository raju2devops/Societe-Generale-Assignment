/**
 * Unit tests for the cryptographic primitives. These are the load-bearing
 * pieces of the data-protection story, so they get their own coverage.
 */
import {
  encryptField,
  decryptField,
  blindIndex,
  hashPassword,
  verifyPassword,
  timingSafeEquals,
  generateAccountNumber,
} from '../src/services/crypto.service.js';
import { INDEX_DOMAINS } from '../src/domain/constants.js';

describe('field encryption (AES-256-GCM)', () => {
  test('round-trips a value', () => {
    const envelope = encryptField('Boulevard Haussmann 29');
    expect(envelope).toMatch(/^v1\.k1\./);
    expect(decryptField(envelope)).toBe('Boulevard Haussmann 29');
  });

  test('is non-deterministic - the same plaintext never yields the same ciphertext', () => {
    expect(encryptField('same value')).not.toBe(encryptField('same value'));
  });

  test('rejects tampered ciphertext instead of returning partial plaintext', () => {
    const envelope = encryptField('sensitive');
    const [v, k, iv, tag, ct] = envelope.split('.');
    const flipped = ct.slice(0, -1) + (ct.at(-1) === 'A' ? 'B' : 'A');
    expect(() => decryptField([v, k, iv, tag, flipped].join('.'))).toThrow();
  });

  test('rejects an envelope re-labelled with a different key id (AAD binding)', () => {
    const [v, , iv, tag, ct] = encryptField('sensitive').split('.');
    expect(() => decryptField([v, 'k9', iv, tag, ct].join('.'))).toThrow(/Unknown field-encryption key id/);
  });

  test('null and empty values pass through untouched', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField('')).toBeNull();
    expect(decryptField(null)).toBeNull();
  });
});

describe('blind index', () => {
  test('is deterministic and case/whitespace insensitive', () => {
    const a = blindIndex(' Jean.Dupont@Example.COM ', INDEX_DOMAINS.ACCOUNT_EMAIL);
    const b = blindIndex('jean.dupont@example.com', INDEX_DOMAINS.ACCOUNT_EMAIL);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test('is namespaced - the same value in two fields does not collide', () => {
    expect(blindIndex('x@y.z', INDEX_DOMAINS.ACCOUNT_EMAIL)).not.toBe(
      blindIndex('x@y.z', INDEX_DOMAINS.USER_EMAIL)
    );
  });

  test('does not reveal the plaintext', () => {
    expect(blindIndex('jean.dupont@example.com', INDEX_DOMAINS.ACCOUNT_EMAIL)).not.toContain('jean');
  });
});

describe('password hashing (scrypt)', () => {
  test('verifies the correct password and rejects the wrong one', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-9!');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('Correct-Horse-Battery-9!', hash)).resolves.toBe(true);
    await expect(verifyPassword('Correct-Horse-Battery-8!', hash)).resolves.toBe(false);
  });

  test('salts uniquely - two hashes of the same password differ', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  test('returns false rather than throwing on a corrupted stored hash', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
  });
});

describe('helpers', () => {
  test('timingSafeEquals handles unequal lengths and empty input safely', () => {
    expect(timingSafeEquals('abc', 'abc')).toBe(true);
    expect(timingSafeEquals('abc', 'abcd')).toBe(false);
    expect(timingSafeEquals('', '')).toBe(false);
    expect(timingSafeEquals(undefined, undefined)).toBe(false);
  });

  test('generated account numbers are unique across 1000 draws', () => {
    const numbers = new Set();
    for (let i = 0; i < 1000; i += 1) numbers.add(generateAccountNumber());
    expect(numbers.size).toBe(1000);
  });

  test('generated account numbers are structurally valid French IBANs', () => {
    for (let i = 0; i < 200; i += 1) {
      const n = generateAccountNumber();
      expect(n).toHaveLength(27);
      expect(n).toMatch(/^FR\d{25}$/);

      // ISO 13616: move the first four characters to the end, map letters to
      // digits, and the whole value mod 97 must equal 1.
      const rearranged = n.slice(4) + n.slice(0, 4);
      const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
      let remainder = 0;
      for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
      expect(remainder).toBe(1);

      // French RIB key: 97 - ((89*bank + 15*branch + 3*account) mod 97)
      const bank = Number(n.slice(4, 9));
      const branch = Number(n.slice(9, 14));
      const account = Number(n.slice(14, 25));
      expect(97 - ((89 * bank + 15 * branch + 3 * account) % 97)).toBe(Number(n.slice(25, 27)));
    }
  });
});
