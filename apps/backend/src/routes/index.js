/** API v1 router. Versioned from day one (OWASP API9:2023 - inventory). */
import { Router } from 'express';
import { createAccountRoutes } from './account.routes.js';
import { createAuthRoutes } from './auth.routes.js';
import { csrfProtection } from '../middleware/csrf.js';

export function createApiRouter(deps) {
  const router = Router();

  /*
   * CSRF is applied per-subtree, NOT across the whole API.
   *
   * The double-submit check requires the caller to echo a cookie this server
   * issued. The endpoints that *issue* that cookie therefore cannot be behind
   * it - `POST /auth/login` is a user's first ever request, so demanding a
   * token it has not been given yet makes login impossible.
   *
   * Those bootstrap endpoints are not left bare. They are still covered by:
   *   - `SameSite=Strict` on every auth cookie, so a cross-site request cannot
   *     carry a session at all (see middleware/cookies.js);
   *   - the strict CORS allow-list, which blocks the pre-flight for any
   *     cross-origin request from an unapproved origin (see app.js);
   *   - the per-IP + per-email rate limiter on /auth (see rateLimiters.js).
   *
   * Every endpoint that acts on an EXISTING session keeps the full check.
   */
  router.use('/auth', createAuthRoutes(deps));
  router.use('/accounts', csrfProtection, createAccountRoutes(deps));

  return router;
}

export default createApiRouter;
