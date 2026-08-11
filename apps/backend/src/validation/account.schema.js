/**
 * Server-side input validation - allow-list only.
 *
 * Mandatory Controls: "Validate and sanitize all user input", "Input validation
 * - type, format, length checks", "Boundary checks and field limits".
 * OWASP A05:2025 Injection.
 *
 * `.strict()` on every object schema means an unexpected property is a 400, not
 * a silently-ignored field. That is what stops mass-assignment / property-level
 * authorization bypass (OWASP API3:2023) - a client cannot smuggle
 * `status: 'ACTIVE'` or `balanceMinor` into a payload that does not declare it.
 */
import { z } from 'zod';
import { ACCOUNT_TYPES, ACCOUNT_STATUSES, CURRENCIES, PAGINATION } from '../domain/constants.js';

/**
 * Reject C0/C1 control characters, zero-width characters and Unicode
 * bidirectional overrides. These are the building blocks of homograph and
 * "Trojan Source" style spoofing and have no business in a name, an address
 * or a closure reason.
 *
 * Expressed as a whole-string `.regex()` rather than a `.refine()` on purpose:
 * `.refine()` returns a ZodEffects, which no longer carries the ZodString
 * methods - so any caller wanting to add a further `.regex()` or `.min()` would
 * fail at module load. Keeping this a ZodString keeps `safeText(n)` composable.
 */
const NO_FORBIDDEN_CHARS =
  // Matching control characters is the whole point: the class rejects C0/C1,
  // zero-width and bidi-override characters. The disable must sit on the line
  // carrying the literal, not on the declaration above it - which is why the
  // previous placement never suppressed anything.
  // eslint-disable-next-line no-control-regex
  /^[^\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]*$/;

const safeText = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NO_FORBIDDEN_CHARS, 'Contains forbidden characters');

const holderName = safeText(120).regex(
  /^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u,
  'Holder name may only contain letters, spaces, apostrophes, dots and hyphens'
);

const email = z.string().trim().toLowerCase().email().max(254);

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{6,19}$/, 'Enter a valid phone number')
  .max(24);

const address = safeText(200);

const branchCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,10}$/, 'Branch code must be 4-10 upper-case letters or digits');

/** Money arrives as a decimal string or number and is converted to minor units. */
const amount = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be between 0 and 1e9' });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

/** Mongo ObjectId, checked by shape before it ever reaches the driver. */
export const objectIdParam = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier'),
});

/** IBAN-ish: 2 country letters, 2 check digits, 10-30 alphanumerics. */
export const accountNumberParam = z.object({
  accountNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, 'Invalid account number format'),
});

export const createAccountSchema = z
  .object({
    holderName,
    email,
    phone: phone.optional(),
    address: address.optional(),
    accountType: z.enum(ACCOUNT_TYPES),
    currency: z.enum(CURRENCIES).default('EUR'),
    branchCode,
    initialDeposit: amount.optional().default(0),
  })
  .strict();

/**
 * Update payload. `status` and `balanceMinor` are deliberately ABSENT - status
 * transitions go through a dedicated endpoint with its own authorisation, and
 * balances only move through posting transactions. A CRUD endpoint must never
 * be a back door into the ledger.
 */
export const updateAccountSchema = z
  .object({
    holderName: holderName.optional(),
    email: email.optional(),
    phone: phone.nullable().optional(),
    address: address.nullable().optional(),
    accountType: z.enum(ACCOUNT_TYPES).optional(),
    branchCode: branchCode.optional(),
    expectedVersion: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).filter((k) => k !== 'expectedVersion').length > 0,
    'At least one updatable field must be supplied'
  );

export const changeStatusSchema = z
  .object({
    status: z.enum(ACCOUNT_STATUSES.filter((s) => s !== 'CLOSED')),
    reason: safeText(500).optional(),
    expectedVersion: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const closeAccountSchema = z
  .object({
    reason: safeText(500),
    expectedVersion: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const SORTABLE = ['createdAt', 'updatedAt', 'openedAt', 'balanceMinor', 'status'];

export const listAccountsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGINATION.MAX_PAGE_SIZE)
      .default(PAGINATION.DEFAULT_PAGE_SIZE),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    accountType: z.enum(ACCOUNT_TYPES).optional(),
    currency: z.enum(CURRENCIES).optional(),
    branchCode: branchCode.optional(),
    // Closed allow-list: the sort key can never be attacker-controlled.
    sortBy: z.enum(SORTABLE).default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
    includeDeleted: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .strict();

export default {
  createAccountSchema,
  updateAccountSchema,
  changeStatusSchema,
  closeAccountSchema,
  listAccountsQuerySchema,
  objectIdParam,
  accountNumberParam,
};
