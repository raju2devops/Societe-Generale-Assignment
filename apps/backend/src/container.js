/**
 * Composition root.
 *
 * This is the ONLY file that knows which concrete implementation backs each
 * port. Services receive their collaborators as constructor arguments and hold
 * no static imports of infrastructure, so the test-suite composes the exact
 * same object graph over in-memory repositories and exercises the real HTTP
 * stack without a database.
 *
 * sc principle #1 - minimise attack surface - shows up here too: nothing
 * is registered globally, so no module can reach a repository it was not
 * explicitly handed.
 */
import { config } from './config/env.js';
import { logger } from './config/logger.js';

import { createMongoAccountRepository } from './repositories/account.repository.mongo.js';
import { createMongoUserRepository } from './repositories/user.repository.mongo.js';
import { createMongoSessionRepository } from './repositories/session.repository.mongo.js';
import { createMongoAuditRepository } from './repositories/audit.repository.mongo.js';

import { createTokenService } from './services/token.service.js';
import { createAuthService } from './services/auth.service.js';
import { createAccountService } from './services/account.service.js';

import { createAccountController } from './controllers/account.controller.js';
import { createAuthController } from './controllers/auth.controller.js';

import { createAuthenticate } from './middleware/authenticate.js';
import { createRequirePermission } from './middleware/authorize.js';

/**
 * @param {object} [overrides] - inject alternative repositories (tests, or a
 *                               future PostgreSQL adapter).
 */
export function buildContainer(overrides = {}) {
  const accountRepository = overrides.accountRepository ?? createMongoAccountRepository();
  const userRepository = overrides.userRepository ?? createMongoUserRepository();
  const sessionRepository = overrides.sessionRepository ?? createMongoSessionRepository();
  const auditRepository = overrides.auditRepository ?? createMongoAuditRepository();

  const tokenService = overrides.tokenService ?? createTokenService({ cfg: config });

  const authService = createAuthService({
    userRepository,
    sessionRepository,
    auditRepository,
    tokenService,
    config,
    logger,
  });

  const accountService = createAccountService({ accountRepository, auditRepository, logger });

  return {
    config,
    logger,
    accountRepository,
    userRepository,
    sessionRepository,
    auditRepository,
    tokenService,
    authService,
    accountService,
    accountController: createAccountController({ accountService }),
    authController: createAuthController({ authService }),
    authenticate: createAuthenticate({ tokenService, userRepository }),
    requirePermission: createRequirePermission({ auditRepository, logger }),
  };
}

export default buildContainer;
