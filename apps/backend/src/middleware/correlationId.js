/**
 * Correlation id propagation (OWASP A09:2025 - structured logs with a
 * correlation id that crosses service boundaries).
 *
 * An inbound `x-correlation-id` is accepted only if it matches a strict UUID-ish
 * shape; anything else is replaced with a freshly generated id. Echoing an
 * attacker-controlled string straight into the log stream is how log injection
 * and log forging start.
 */
import crypto from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function correlationId(req, res, next) {
  const inbound = req.get('x-correlation-id');
  req.correlationId = inbound && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}

export default correlationId;
