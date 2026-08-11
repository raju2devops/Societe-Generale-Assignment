/**
 * Authentication middleware.
 *
 * The access token is read from an HttpOnly cookie, NOT from `localStorage` via
 * an Authorization header: a token that JavaScript cannot read cannot be
 * exfiltrated by an XSS payload. CSRF - the trade-off that cookie auth brings -
 * is handled separately in middleware/csrf.js.
 *
 * After the signature check the principal is re-loaded from the database on
 * every request, so a deactivated operator or a role downgrade takes effect
 * immediately instead of at token expiry (OWASP A01:2025).
 */
import { SessionError } from '../errors/AppError.js';
import { COOKIE_NAMES } from './cookies.js';

export function createAuthenticate({ tokenService, userRepository }) {
  return async function authenticate(req, _res, next) {
    try {
      const token = req.cookies?.[COOKIE_NAMES.access];
      if (!token) throw new SessionError('no access cookie presented');

      let payload;
      try {
        payload = tokenService.verifyAccessToken(token);
      } catch (err) {
        throw new SessionError(`access token rejected: ${err.message}`);
      }

      const user = await userRepository.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new SessionError('principal missing or deactivated');
      }

      req.actor = Object.freeze({
        id: user._id,
        role: user.role, // authoritative value from the DB, not from the token
        displayName: user.displayName,
        sessionFamilyId: payload.sid,
        mustChangePassword: Boolean(user.mustChangePassword),
      });

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export default createAuthenticate;
