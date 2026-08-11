/**
 * Authentication / session business logic.
 *
 * The service owns the rules; the controller only translates HTTP. Nothing in
 * this file imports Express or Mongoose - it is driven entirely through the
 * injected repository ports, which is why the whole flow is testable against
 * in-memory doubles.
 *
 * Mandatory Controls implemented here:
 *   - Generic auth failure messages (no user enumeration)
 *   - Account lockout after 3 failed attempts
 *   - Password history of 10, no re-use
 *   - Password expiry after 90 days
 *   - "Inform the user of last successful login and failed attempts since"
 *   - Session rotation on authentication and on every refresh
 *   - Idle timeout + absolute timeout
 *   - Refresh-token reuse detection (family revocation)
 */
import {
  hashPassword,
  verifyPassword,
  blindIndex,
  encryptField,
  sha256,
  randomToken,
} from './crypto.service.js';
import { INDEX_DOMAINS, AUDIT_ACTIONS } from '../domain/constants.js';
import { PASSWORD_POLICY } from '../validation/auth.schema.js';
import {
  AuthenticationError,
  SessionError,
  LockedError,
  BusinessRuleError,
} from '../errors/AppError.js';

const MS_PER_DAY = 86_400_000;

export function createAuthService({ userRepository, sessionRepository, auditRepository, tokenService, config, logger }) {
  /**
   * Constant-ish work regardless of whether the user exists. Verifying against
   * a throwaway hash keeps the timing profile of "unknown e-mail" close to
   * "known e-mail, wrong password", which is what stops user enumeration by
   * stopwatch.
   */
  const DUMMY_HASH_PROMISE = hashPassword(randomToken(24));

  async function audit(entry) {
    try {
      await auditRepository.append({ occurredAt: new Date(), ...entry });
    } catch (err) {
      // Never let an audit write failure take down the request path, but never
      // let it pass unnoticed either.
      logger?.error({ err: err.message }, 'audit_write_failed');
    }
  }

  function passwordAgeDays(user) {
    const changed = user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0;
    return (Date.now() - changed) / MS_PER_DAY;
  }

  return {
    /**
     * @returns {{user, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt,
     *            lastLoginAt, failedSinceLastLogin, passwordExpiresInDays}}
     */
    async login({ email, password, clientFingerprint, correlationId }) {
      const emailIndex = blindIndex(email, INDEX_DOMAINS.USER_EMAIL);
      const user = await userRepository.findByEmailIndex(emailIndex);

      if (!user) {
        await verifyPassword(password, await DUMMY_HASH_PROMISE);
        await audit({
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          outcome: 'FAILURE',
          correlationId,
          metadata: { reason: 'unknown_principal' },
        });
        throw new AuthenticationError('login attempt for unknown e-mail index');
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        await audit({
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          outcome: 'FAILURE',
          actorId: user._id,
          correlationId,
          metadata: { reason: 'locked' },
        });
        throw new LockedError('login attempt against a locked account');
      }

      if (!user.isActive) {
        await audit({
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          outcome: 'FAILURE',
          actorId: user._id,
          correlationId,
          metadata: { reason: 'deactivated' },
        });
        throw new AuthenticationError('login attempt against a deactivated account');
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        const failedAttempts = (user.failedAttempts ?? 0) + 1;
        const shouldLock = failedAttempts >= config.auth.maxFailedAttempts;
        await userRepository.updateById(user._id, {
          failedAttempts: shouldLock ? 0 : failedAttempts,
          failedSinceLastLogin: (user.failedSinceLastLogin ?? 0) + 1,
          lockedUntil: shouldLock
            ? new Date(Date.now() + config.auth.lockoutMinutes * 60_000)
            : (user.lockedUntil ?? null),
        });
        await audit({
          action: shouldLock ? AUDIT_ACTIONS.ACCOUNT_LOCKED : AUDIT_ACTIONS.LOGIN_FAILED,
          outcome: 'FAILURE',
          actorId: user._id,
          correlationId,
          metadata: { attempt: failedAttempts },
        });
        // Same error either way - the caller learns nothing about which of the
        // two credential halves was wrong, nor how close to lockout they are.
        throw new AuthenticationError('invalid password');
      }

      const previousLoginAt = user.lastLoginAt ?? null;
      const previousFailures = user.failedSinceLastLogin ?? 0;

      await userRepository.updateById(user._id, {
        failedAttempts: 0,
        failedSinceLastLogin: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      });

      // New session family on every successful authentication - session ids are
      // never reused across a privilege transition.
      const familyId = randomToken(16);
      const { token: refreshToken, expiresAt: refreshExpiresAt } = tokenService.issueRefreshToken();
      await sessionRepository.create({
        userId: user._id,
        tokenHash: sha256(refreshToken),
        familyId,
        issuedAt: new Date(),
        expiresAt: refreshExpiresAt,
        lastUsedAt: new Date(),
        clientFingerprint: clientFingerprint ? sha256(clientFingerprint) : null,
      });

      const { token: accessToken, expiresAt: accessExpiresAt } = tokenService.issueAccessToken({
        userId: user._id,
        role: user.role,
        sessionFamilyId: familyId,
      });

      await audit({
        action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
        outcome: 'SUCCESS',
        actorId: user._id,
        actorRole: user.role,
        correlationId,
      });

      const ageDays = passwordAgeDays(user);
      return {
        user: { ...user, lastLoginAt: previousLoginAt, failedSinceLastLogin: previousFailures },
        accessToken,
        accessExpiresAt,
        refreshToken,
        refreshExpiresAt,
        passwordExpiresInDays: Math.max(0, Math.ceil(PASSWORD_POLICY.maxAgeDays - ageDays)),
        mustChangePassword:
          Boolean(user.mustChangePassword) || ageDays > PASSWORD_POLICY.maxAgeDays,
      };
    },

    /**
     * Rotating refresh. The presented token is revoked and replaced on every
     * call, and re-presenting an already-rotated token kills the whole family -
     * the standard defence against a stolen refresh token.
     */
    async refresh({ refreshToken, clientFingerprint, correlationId }) {
      if (!refreshToken) throw new SessionError('no refresh token presented');

      const tokenHash = sha256(refreshToken);
      const session = await sessionRepository.findActiveByTokenHash(tokenHash);

      if (!session) {
        // Either expired, revoked, or a replay of a rotated token. If we can
        // identify the family, burn it.
        const replayed = await sessionRepository.findAnyByTokenHash?.(tokenHash);
        if (replayed?.familyId) {
          await sessionRepository.revokeFamily(replayed.familyId, 'refresh_token_reuse_detected');
          logger?.warn({ correlationId }, 'refresh_token_reuse_detected');
        }
        throw new SessionError('refresh token not active');
      }

      const idleMs = Date.now() - new Date(session.lastUsedAt).getTime();
      if (idleMs > config.tokens.refreshIdleTimeout * 1000) {
        await sessionRepository.revokeById(session._id, 'idle_timeout');
        throw new SessionError('session exceeded idle timeout');
      }

      const user = await userRepository.findById(session.userId);
      if (!user || !user.isActive) {
        await sessionRepository.revokeFamily(session.familyId, 'principal_inactive');
        throw new SessionError('principal no longer active');
      }

      await sessionRepository.revokeById(session._id, 'rotated');
      const { token: newRefresh, expiresAt: refreshExpiresAt } = tokenService.issueRefreshToken();
      // The rotated token inherits the ORIGINAL absolute expiry, so refreshing
      // can never extend a session past its absolute timeout.
      const cappedExpiry = new Date(
        Math.min(refreshExpiresAt.getTime(), new Date(session.expiresAt).getTime())
      );
      await sessionRepository.create({
        userId: user._id,
        tokenHash: sha256(newRefresh),
        familyId: session.familyId,
        issuedAt: new Date(),
        expiresAt: cappedExpiry,
        lastUsedAt: new Date(),
        clientFingerprint: clientFingerprint ? sha256(clientFingerprint) : null,
      });

      const { token: accessToken, expiresAt: accessExpiresAt } = tokenService.issueAccessToken({
        userId: user._id,
        role: user.role,
        sessionFamilyId: session.familyId,
      });

      return {
        user,
        accessToken,
        accessExpiresAt,
        refreshToken: newRefresh,
        refreshExpiresAt: cappedExpiry,
      };
    },

    async logout({ refreshToken, actorId, correlationId }) {
      if (refreshToken) {
        const session = await sessionRepository.findActiveByTokenHash(sha256(refreshToken));
        if (session) await sessionRepository.revokeFamily(session.familyId, 'logout');
      }
      await audit({
        action: AUDIT_ACTIONS.LOGOUT,
        outcome: 'SUCCESS',
        actorId: actorId ?? null,
        correlationId,
      });
    },

    /**
     * Mandatory Control: "'Change password' requires the old password", plus
     * history-of-10 enforcement and full session revocation afterwards.
     */
    async changePassword({ userId, currentPassword, newPassword, correlationId }) {
      const user = await userRepository.findById(userId);
      if (!user) throw new AuthenticationError('change-password for unknown principal');

      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        await audit({
          action: AUDIT_ACTIONS.PASSWORD_CHANGED,
          outcome: 'FAILURE',
          actorId: user._id,
          correlationId,
          metadata: { reason: 'current_password_mismatch' },
        });
        throw new AuthenticationError('current password mismatch');
      }

      const history = [user.passwordHash, ...(user.passwordHistory ?? [])].slice(
        0,
        config.auth.passwordHistorySize
      );
      for (const old of history) {
        if (await verifyPassword(newPassword, old)) {
          throw new BusinessRuleError(
            `You cannot re-use any of your last ${config.auth.passwordHistorySize} passwords.`,
            'password history violation'
          );
        }
      }

      await userRepository.updateById(user._id, {
        passwordHash: await hashPassword(newPassword),
        passwordHistory: history,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      });

      // Every existing session is invalidated: a password change must evict an
      // attacker who already holds a live session.
      await sessionRepository.revokeAllForUser(user._id, 'password_changed');

      await audit({
        action: AUDIT_ACTIONS.PASSWORD_CHANGED,
        outcome: 'SUCCESS',
        actorId: user._id,
        actorRole: user.role,
        correlationId,
      });
    },

    /** Used by the seed script only. */
    async createUser({ email, displayName, password, role }) {
      const emailIndex = blindIndex(email, INDEX_DOMAINS.USER_EMAIL);
      const existing = await userRepository.findByEmailIndex(emailIndex);
      if (existing) throw new BusinessRuleError('An operator with that e-mail already exists.');
      return userRepository.create({
        emailEnc: encryptField(email),
        emailIndex,
        displayName,
        passwordHash: await hashPassword(password),
        passwordHistory: [],
        passwordChangedAt: new Date(),
        role,
        isActive: true,
      });
    },
  };
}

export default createAuthService;
