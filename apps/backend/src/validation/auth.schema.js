/**
 * Authentication payload validation + the sc password policy.
 *
 * Mandatory Controls: "Password complexity requirements", "Implement strong
 * password policies", "'Change password' requires the old password".
 */
import { z } from 'zod';

export const PASSWORD_POLICY = Object.freeze({
  minLength: 14,
  maxLength: 128,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true,
  maxAgeDays: 90,
  historySize: 10,
});

/**
 * A small deny-list of values that pass the complexity rules but are trivially
 * guessable in this specific product. Complexity alone is a weak control; this
 * closes the most obvious gap without pretending to be a full breach-corpus
 * check (that belongs to the IdP, which is the production path).
 */
const BANNED_SUBSTRINGS = ['societegenerale', 'sgbank', 'password', 'qwerty', '123456'];

export const passwordSchema = z
  .string()
  .min(PASSWORD_POLICY.minLength, `Password must be at least ${PASSWORD_POLICY.minLength} characters`)
  .max(PASSWORD_POLICY.maxLength)
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an upper-case letter')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lower-case letter')
  .refine((v) => /\d/.test(v), 'Password must contain a digit')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Password must contain a symbol')
  .refine(
    (v) => !BANNED_SUBSTRINGS.some((bad) => v.toLowerCase().includes(bad)),
    'Password contains a forbidden common word'
  );

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    // Login must NOT apply the complexity policy: doing so would tell an
    // attacker which submitted strings could never be a real password.
    password: z.string().min(1).max(PASSWORD_POLICY.maxLength),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_POLICY.maxLength),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must differ from the current one',
    path: ['newPassword'],
  });

export default { loginSchema, changePasswordSchema, passwordSchema, PASSWORD_POLICY };
