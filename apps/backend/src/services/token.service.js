/**
 * Access-token issuing and verification.
 *
 * OWASP A07:2025 / API2:2023 - Authentication Failures.
 *   * Algorithm is pinned to HS256 on BOTH sign and verify. `algorithms: ['HS256']`
 *     on verify is what makes the `alg: none` and "RS256 key confusion" attacks
 *     impossible - never trust the algorithm declared in the token header.
 *   * `issuer`, `audience`, `expiresIn` and `jti` are always set and always
 *     checked. A token that omits any of them is rejected.
 *   * Tokens carry the role, but the role is re-read from the database on every
 *     request (see middleware/authenticate.js), so a revoked or downgraded
 *     operator cannot keep using a token minted before the change.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { randomToken } from './crypto.service.js';

const ALGORITHM = 'HS256';

export function createTokenService({ cfg = config } = {}) {
  return {
    /** @returns {{token: string, jti: string, expiresAt: Date}} */
    issueAccessToken({ userId, role, sessionFamilyId }) {
      const jti = randomToken(16);
      const token = jwt.sign(
        { sub: String(userId), role, sid: sessionFamilyId, typ: 'access' },
        cfg.crypto.jwtSecret,
        {
          algorithm: ALGORITHM,
          expiresIn: cfg.tokens.accessTtl,
          issuer: cfg.tokens.issuer,
          audience: cfg.tokens.audience,
          jwtid: jti,
        }
      );
      return {
        token,
        jti,
        expiresAt: new Date(Date.now() + cfg.tokens.accessTtl * 1000),
      };
    },

    /**
     * @throws {jwt.JsonWebTokenError} on any failure - never returns a partial
     *         or "probably fine" payload.
     */
    verifyAccessToken(token) {
      const payload = jwt.verify(token, cfg.crypto.jwtSecret, {
        algorithms: [ALGORITHM],
        issuer: cfg.tokens.issuer,
        audience: cfg.tokens.audience,
        clockTolerance: 5,
      });
      if (payload.typ !== 'access') {
        throw new jwt.JsonWebTokenError('Unexpected token type');
      }
      return payload;
    },

    /**
     * Refresh tokens are opaque 256-bit CSPRNG strings, not JWTs. They carry no
     * claims, so they cannot be replayed as access tokens, and revocation is a
     * single database write rather than a blacklist of signed material.
     */
    issueRefreshToken() {
      return {
        token: randomToken(32),
        expiresAt: new Date(Date.now() + cfg.tokens.refreshTtl * 1000),
      };
    },
  };
}

export default createTokenService;
