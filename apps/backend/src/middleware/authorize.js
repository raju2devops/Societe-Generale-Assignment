/**
 * Authorisation middleware - default deny.
 *
 * Every protected route must declare the permission it needs. A route that
 * forgets to declare one gets no access at all, because `requirePermission`
 * is the only thing that clears the gate (see routes/index.js, where the
 * router-level guard asserts that each route carries one).
 *
 * OWASP A01:2025 Broken Access Control, API5:2023 Broken Function Level
 * Authorization.
 */
import { AuthorizationError } from '../errors/AppError.js';
import { roleHasPermission, AUDIT_ACTIONS } from '../domain/constants.js';

export function createRequirePermission({ auditRepository, logger }) {
  return function requirePermission(permission) {
    return async function authorize(req, _res, next) {
      const actor = req.actor;
      if (!actor) return next(new AuthorizationError('authorize ran without an authenticated actor'));

      if (!roleHasPermission(actor.role, permission)) {
        try {
          await auditRepository.append({
            action: AUDIT_ACTIONS.ACCESS_DENIED,
            outcome: 'FAILURE',
            actorId: actor.id,
            actorRole: actor.role,
            correlationId: req.correlationId,
            occurredAt: new Date(),
            metadata: { permission, method: req.method, route: req.route?.path ?? req.path },
          });
        } catch (err) {
          logger?.error({ err: err.message }, 'audit_write_failed');
        }
        return next(new AuthorizationError(`role ${actor.role} lacks ${permission}`));
      }

      return next();
    };
  };
}

export default createRequirePermission;
