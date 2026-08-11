/**
 * Auth controller.
 *
 * Tokens are delivered as cookies and never appear in a response body, a URL or
 * a log line. The body carries only the profile and a "last successful login"
 * notice (Mandatory Control: "Inform the user of last successful login and any
 * failed attempts since").
 */
import { toUserProfile } from '../dto/account.dto.js';
import { randomToken } from '../services/crypto.service.js';
import { setAuthCookies, clearAuthCookies, COOKIE_NAMES } from '../middleware/cookies.js';

/** Coarse, non-identifying client fingerprint used to bind a session. */
function fingerprint(req) {
  return `${req.ip}|${req.get('user-agent') ?? ''}`;
}

export function createAuthController({ authService }) {
  return {
    async login(req, res) {
      const result = await authService.login({
        email: req.body.email,
        password: req.body.password,
        clientFingerprint: fingerprint(req),
        correlationId: req.correlationId,
      });

      const csrfToken = randomToken(24);
      setAuthCookies(res, { ...result, csrfToken });

      res.status(200).json({
        data: {
          user: toUserProfile(result.user),
          csrfToken,
          session: {
            accessExpiresAt: result.accessExpiresAt,
            refreshExpiresAt: result.refreshExpiresAt,
          },
          notice: {
            lastLoginAt: result.user.lastLoginAt ?? null,
            failedAttemptsSinceLastLogin: result.user.failedSinceLastLogin ?? 0,
            passwordExpiresInDays: result.passwordExpiresInDays,
            mustChangePassword: result.mustChangePassword,
          },
        },
      });
    },

    async refresh(req, res) {
      const result = await authService.refresh({
        refreshToken: req.cookies?.[COOKIE_NAMES.refresh],
        clientFingerprint: fingerprint(req),
        correlationId: req.correlationId,
      });

      const csrfToken = randomToken(24);
      setAuthCookies(res, { ...result, csrfToken });

      res.status(200).json({
        data: {
          user: toUserProfile(result.user),
          csrfToken,
          session: {
            accessExpiresAt: result.accessExpiresAt,
            refreshExpiresAt: result.refreshExpiresAt,
          },
        },
      });
    },

    async logout(req, res) {
      await authService.logout({
        refreshToken: req.cookies?.[COOKIE_NAMES.refresh],
        actorId: req.actor?.id ?? null,
        correlationId: req.correlationId,
      });
      clearAuthCookies(res);
      res.status(204).send();
    },

    async me(req, res) {
      res.status(200).json({
        data: {
          id: String(req.actor.id),
          displayName: req.actor.displayName,
          role: req.actor.role,
          mustChangePassword: req.actor.mustChangePassword,
        },
      });
    },

    async changePassword(req, res) {
      await authService.changePassword({
        userId: req.actor.id,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
        correlationId: req.correlationId,
      });
      // Every session was revoked - force a fresh sign-in.
      clearAuthCookies(res);
      res.status(204).send();
    },
  };
}

export default createAuthController;
