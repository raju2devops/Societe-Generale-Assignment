/**
 * Account routes.
 *
 * Every single route declares:
 *   authenticate -> requirePermission(...) -> validate({...}) -> handler
 * in that order. Nothing is protected "by convention"; the guard is explicit
 * and visible on each line (OWASP API5:2023).
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import { PERMISSIONS } from '../domain/constants.js';
import {
  createAccountSchema,
  updateAccountSchema,
  changeStatusSchema,
  closeAccountSchema,
  listAccountsQuerySchema,
  objectIdParam,
  accountNumberParam,
} from '../validation/account.schema.js';

export function createAccountRoutes({ accountController, authenticate, requirePermission }) {
  const router = Router();

  // Everything below requires an authenticated principal.
  router.use(authenticate);

  // ---- CREATE ---------------------------------------------------------------
  router.post(
    '/',
    writeLimiter,
    requirePermission(PERMISSIONS.ACCOUNT_CREATE),
    validate({ body: createAccountSchema }),
    asyncHandler(accountController.create)
  );

  // ---- READ -----------------------------------------------------------------
  router.get(
    '/',
    requirePermission(PERMISSIONS.ACCOUNT_READ),
    validate({ query: listAccountsQuerySchema }),
    asyncHandler(accountController.list)
  );

  // Declared BEFORE '/:id' so a literal path segment can never be swallowed by
  // the parameterised route.
  router.get(
    '/by-number/:accountNumber',
    requirePermission(PERMISSIONS.ACCOUNT_READ),
    validate({ params: accountNumberParam }),
    asyncHandler(accountController.getByAccountNumber)
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.ACCOUNT_READ),
    validate({ params: objectIdParam }),
    asyncHandler(accountController.getById)
  );

  // ---- UPDATE ---------------------------------------------------------------
  router.put(
    '/:id',
    writeLimiter,
    requirePermission(PERMISSIONS.ACCOUNT_UPDATE),
    validate({ params: objectIdParam, body: updateAccountSchema }),
    asyncHandler(accountController.update)
  );

  router.patch(
    '/:id/status',
    writeLimiter,
    requirePermission(PERMISSIONS.ACCOUNT_UPDATE),
    validate({ params: objectIdParam, body: changeStatusSchema }),
    asyncHandler(accountController.changeStatus)
  );

  // ---- DELETE ---------------------------------------------------------------
  // Soft close. Retains the record for audit and regulatory retention.
  router.delete(
    '/:id',
    writeLimiter,
    requirePermission(PERMISSIONS.ACCOUNT_DELETE),
    validate({ params: objectIdParam, body: closeAccountSchema }),
    asyncHandler(accountController.close)
  );

  // Irreversible erasure (GDPR Art.17). Admin only, closed accounts only.
  router.delete(
    '/:id/purge',
    writeLimiter,
    requirePermission(PERMISSIONS.ACCOUNT_PURGE),
    validate({ params: objectIdParam }),
    asyncHandler(accountController.purge)
  );

  return router;
}

export default createAccountRoutes;
