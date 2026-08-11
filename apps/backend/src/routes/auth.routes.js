/** Authentication routes. */
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimiters.js';
import { csrfProtection } from '../middleware/csrf.js';
import { loginSchema, changePasswordSchema } from '../validation/auth.schema.js';

export function createAuthRoutes({ authController, authenticate }) {
  const router = Router();

  // Credentials are POST-only. Mandatory Control: "Never use GET for
  // authentication data". `Cache-Control: no-store` is applied to the whole
  // /auth subtree so a shared proxy can never retain a token-bearing response.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // ---- Session bootstrap: no CSRF token can exist yet ----------------------
  // These two endpoints ISSUE the CSRF cookie, so they cannot require it.
  // Protected instead by SameSite=Strict cookies, the CORS allow-list and the
  // auth rate limiter. See the comment in routes/index.js.

  router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));

  router.post('/refresh', authLimiter, asyncHandler(authController.refresh));

  // ---- Acts on an existing session: full CSRF check ------------------------

  router.post('/logout', csrfProtection, asyncHandler(authController.logout));

  router.get('/me', authenticate, asyncHandler(authController.me));

  // Re-authentication for an account-management function, even with a valid
  // session (Mandatory Control).
  router.post(
    '/change-password',
    authLimiter,
    csrfProtection,
    authenticate,
    validate({ body: changePasswordSchema }),
    asyncHandler(authController.changePassword)
  );

  return router;
}

export default createAuthRoutes;
