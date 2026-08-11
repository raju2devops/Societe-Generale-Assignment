/**
 * CSRF protection - signed double-submit cookie.
 *
 * Cookie-based sessions need CSRF defence. Three layers are stacked here:
 *   1. `SameSite=strict` on the auth cookies (browser-enforced).
 *   2. This double-submit check on every state-changing method: the caller must
 *      echo the CSRF cookie value in the `x-csrf-token` header. A cross-origin
 *      attacker can cause the cookie to be sent but cannot read it, so it
 *      cannot set the header.
 *   3. A strict CORS allow-list, which stops the pre-flight for a cross-origin
 *      request carrying a custom header.
 *
 * Comparison is constant-time to avoid leaking the token byte by byte.
 */
import { AppError } from '../errors/AppError.js';
import { timingSafeEquals } from '../services/crypto.service.js';
import { COOKIE_NAMES } from './cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[COOKIE_NAMES.csrf];
  const headerToken = req.get('x-csrf-token');

  if (!cookieToken || !headerToken || !timingSafeEquals(cookieToken, headerToken)) {
    return next(
      new AppError('CSRF validation failed. Refresh the page and try again.', {
        status: 403,
        code: 'CSRF_FAILED',
        logDetail: `csrf mismatch: cookiePresent=${Boolean(cookieToken)} headerPresent=${Boolean(headerToken)}`,
      })
    );
  }

  return next();
}

export default csrfProtection;
