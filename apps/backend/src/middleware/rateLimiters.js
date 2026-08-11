/**
 * Rate limiting.
 *
 * OWASP API4:2023 (Unrestricted Resource Consumption) and the Sapiens "DDoS
 * protection" controls - limit resource allocation per user, quota
 * authenticated users, and limit unauthenticated access to expensive resources.
 *
 * The login limiter is deliberately much tighter than the general one:
 * credential stuffing is the highest-value attack against this surface.
 */
import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const disabled = config.isTest; // deterministic tests, never disabled elsewhere

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
  },
};

/** Whole-API budget, keyed by IP. */
export const globalLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 300,
});

/**
 * Normalise the client address before it becomes a rate-limit key.
 *
 * An IPv6 client is typically handed a whole /64, so keying on the full address
 * would let one attacker rotate through 2^64 free buckets. Truncating to the
 * /64 prefix makes the limit meaningful. IPv4 is used as-is.
 */
function clientKey(req) {
  const ip = req.ip ?? '';
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':') + '::/64';
}

/** Authentication endpoints, keyed by client prefix + submitted e-mail. */
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: (req) =>
    `${clientKey(req)}|${String(req.body?.email ?? '').toLowerCase().slice(0, 254)}`,
});

/** Writes are cheaper to abuse than reads and more expensive to undo. */
export const writeLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 30,
});

export default { globalLimiter, authLimiter, writeLimiter };
