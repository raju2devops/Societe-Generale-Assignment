/**
 * Bank-account business logic - the service layer.
 *
 * This is where transactions, validation-beyond-syntax, encryption, audit and
 * authorisation-in-depth live. Controllers do HTTP; repositories do storage;
 * neither contains a business rule. Framework-free by design: no Express, no
 * Mongoose import anywhere in this file.
 */
import {
  encryptField,
  blindIndex,
  generateAccountNumber,
  decryptField,
} from './crypto.service.js';
import { INDEX_DOMAINS, AUDIT_ACTIONS, PERMISSIONS, roleHasPermission } from '../domain/constants.js';
import {
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  AuthorizationError,
} from '../errors/AppError.js';

/** Statuses from which an account may still be modified. */
const MUTABLE_STATUSES = new Set(['ACTIVE', 'DORMANT', 'FROZEN']);

export function createAccountService({ accountRepository, auditRepository, logger }) {
  async function audit(entry) {
    try {
      await auditRepository.append({ occurredAt: new Date(), ...entry });
    } catch (err) {
      logger?.error({ err: err.message }, 'audit_write_failed');
    }
  }

  /**
   * Defence in depth. The route already declared the required permission; the
   * service checks it again so a new caller (a scheduled job, a GraphQL
   * resolver, a future BFF) cannot bypass authorisation by skipping the HTTP
   * middleware. OWASP A01:2025.
   */
  function assertPermission(actor, permission) {
    if (!actor || !roleHasPermission(actor.role, permission)) {
      throw new AuthorizationError(`role ${actor?.role} lacks ${permission}`);
    }
  }

  /** Allocate a collision-free account number; bounded retries, then fail. */
  async function allocateAccountNumber() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateAccountNumber();
      const index = blindIndex(candidate, INDEX_DOMAINS.ACCOUNT_NUMBER);
      if (!(await accountRepository.existsByAccountNumberIndex(index))) {
        return { accountNumber: candidate, accountNumberIndex: index };
      }
    }
    // Fail securely: never fall back to a predictable or duplicate number.
    throw new ConflictError(
      'Could not allocate a unique account number. Please retry.',
      'account number allocation exhausted after 5 attempts'
    );
  }

  return {
    async create({ actor, payload, correlationId }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_CREATE);

      const { accountNumber, accountNumberIndex } = await allocateAccountNumber();

      const created = await accountRepository.create({
        accountNumberEnc: encryptField(accountNumber),
        accountNumberIndex,
        holderNameEnc: encryptField(payload.holderName),
        emailEnc: encryptField(payload.email),
        emailIndex: blindIndex(payload.email, INDEX_DOMAINS.ACCOUNT_EMAIL),
        phoneEnc: encryptField(payload.phone ?? null),
        addressEnc: encryptField(payload.address ?? null),
        accountType: payload.accountType,
        currency: payload.currency,
        balanceMinor: payload.initialDeposit ?? 0,
        branchCode: payload.branchCode,
        status: 'ACTIVE',
        openedAt: new Date(),
        createdBy: actor.id,
        isDeleted: false,
      });

      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_CREATED,
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorRole: actor.role,
        subjectType: 'Account',
        subjectId: String(created._id ?? created.id),
        correlationId,
        metadata: { accountType: created.accountType, branchCode: created.branchCode },
      });

      return created;
    },

    async getById({ actor, id, correlationId }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_READ);
      const doc = await accountRepository.findById(id);
      if (!doc) throw new NotFoundError('Account', `account ${id} not found or soft-deleted`);
      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_VIEWED,
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorRole: actor.role,
        subjectType: 'Account',
        subjectId: String(doc._id ?? doc.id),
        correlationId,
      });
      return doc;
    },

    /**
     * Lookup by account number - the flagship read in the brief.
     * The plaintext number never hits the database: it is converted to a keyed
     * blind index and matched on that.
     */
    async getByAccountNumber({ actor, accountNumber, correlationId }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_READ);
      const index = blindIndex(accountNumber, INDEX_DOMAINS.ACCOUNT_NUMBER);
      const doc = await accountRepository.findByAccountNumberIndex(index);
      if (!doc) throw new NotFoundError('Account', 'account number lookup miss');
      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_VIEWED,
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorRole: actor.role,
        subjectType: 'Account',
        subjectId: String(doc._id ?? doc.id),
        correlationId,
        metadata: { via: 'accountNumber' },
      });
      return doc;
    },

    async list({ actor, query }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_READ);
      // Only an admin may see soft-deleted (closed) records.
      const includeDeleted =
        query.includeDeleted === true && roleHasPermission(actor.role, PERMISSIONS.ACCOUNT_DELETE);

      return accountRepository.findMany(
        {
          status: query.status,
          accountType: query.accountType,
          currency: query.currency,
          branchCode: query.branchCode,
          includeDeleted,
        },
        {
          page: query.page,
          pageSize: query.pageSize,
          sort: { [query.sortBy]: query.sortDir === 'asc' ? 1 : -1 },
        }
      );
    },

    async update({ actor, id, payload, correlationId }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_UPDATE);

      const current = await accountRepository.findById(id);
      if (!current) throw new NotFoundError('Account', `update target ${id} missing`);
      if (!MUTABLE_STATUSES.has(current.status)) {
        throw new BusinessRuleError(
          `An account with status ${current.status} cannot be modified.`,
          'update attempted on immutable status'
        );
      }

      // Explicit field-by-field mapping. There is no `Object.assign(doc, body)`
      // anywhere in this codebase - mass assignment is impossible by construction.
      const patch = { updatedBy: actor.id };
      const changedFields = [];
      if (payload.holderName !== undefined) {
        patch.holderNameEnc = encryptField(payload.holderName);
        changedFields.push('holderName');
      }
      if (payload.email !== undefined) {
        patch.emailEnc = encryptField(payload.email);
        patch.emailIndex = blindIndex(payload.email, INDEX_DOMAINS.ACCOUNT_EMAIL);
        changedFields.push('email');
      }
      if (payload.phone !== undefined) {
        patch.phoneEnc = encryptField(payload.phone);
        changedFields.push('phone');
      }
      if (payload.address !== undefined) {
        patch.addressEnc = encryptField(payload.address);
        changedFields.push('address');
      }
      if (payload.accountType !== undefined) {
        patch.accountType = payload.accountType;
        changedFields.push('accountType');
      }
      if (payload.branchCode !== undefined) {
        patch.branchCode = payload.branchCode;
        changedFields.push('branchCode');
      }

      const updated = await accountRepository.updateById(id, patch, {
        expectedVersion: payload.expectedVersion,
      });
      if (!updated) {
        throw new ConflictError(
          'This account was modified by someone else. Reload and try again.',
          'optimistic concurrency conflict'
        );
      }

      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_UPDATED,
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorRole: actor.role,
        subjectType: 'Account',
        subjectId: String(updated._id ?? updated.id),
        correlationId,
        // Field NAMES only. Never the old or new values - those are PII.
        metadata: { changedFields },
      });

      return updated;
    },

    async changeStatus({ actor, id, payload, correlationId }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_UPDATE);
      const current = await accountRepository.findById(id);
      if (!current) throw new NotFoundError('Account', `status change target ${id} missing`);
      if (current.status === payload.status) return current;

      const updated = await accountRepository.updateById(
        id,
        { status: payload.status, updatedBy: actor.id },
        { expectedVersion: payload.expectedVersion }
      );
      if (!updated) {
        throw new ConflictError('This account was modified by someone else. Reload and try again.');
      }
      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_UPDATED,
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorRole: actor.role,
        subjectType: 'Account',
        subjectId: String(id),
        correlationId,
        metadata: { from: current.status, to: payload.status },
      });
      return updated;
    },

    /**
     * "Safely delete accounts" - a soft close, not an erasure.
     * A bank account with money in it, or one already closed, cannot be deleted.
     * The record is retained (closed + flagged) so the audit trail and
     * regulatory retention obligations survive the delete.
     */
    async close({ actor, id, payload, correlationId }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_DELETE);

      const current = await accountRepository.findById(id);
      if (!current) throw new NotFoundError('Account', `close target ${id} missing`);
      if (current.balanceMinor !== 0) {
        throw new BusinessRuleError(
          'An account with a non-zero balance cannot be closed. Transfer the funds first.',
          'close blocked by non-zero balance'
        );
      }

      const closed = await accountRepository.softDeleteById(id, {
        closedBy: actor.id,
        closureReason: payload?.reason ?? null,
        expectedVersion: payload?.expectedVersion,
      });
      if (!closed) {
        throw new ConflictError('This account was modified by someone else. Reload and try again.');
      }

      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_CLOSED,
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorRole: actor.role,
        subjectType: 'Account',
        subjectId: String(id),
        correlationId,
      });
      return closed;
    },

    /**
     * Irreversible erasure, admin-only, for GDPR Art.17 ("right to be
     * forgotten"). Only a already-closed account may be purged, so this cannot
     * be used to make a live account disappear.
     */
    async purge({ actor, id, correlationId }) {
      assertPermission(actor, PERMISSIONS.ACCOUNT_PURGE);

      const current = await accountRepository.findById(id, { includeDeleted: true });
      if (!current) throw new NotFoundError('Account', `purge target ${id} missing`);
      if (!current.isDeleted) {
        throw new BusinessRuleError(
          'Only a closed account can be purged. Close it first.',
          'purge attempted on live account'
        );
      }

      await accountRepository.hardDeleteById(id);
      await audit({
        action: AUDIT_ACTIONS.ACCOUNT_PURGED,
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorRole: actor.role,
        subjectType: 'Account',
        subjectId: String(id),
        correlationId,
        metadata: { basis: 'gdpr_art_17' },
      });
    },

    /** Exposed for the seed script / integration tests only. */
    _decrypt: decryptField,
  };
}

export default createAccountService;
