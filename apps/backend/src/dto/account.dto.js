/**
 * Response mappers (view models).
 *
 * OWASP API3:2023 - Broken Object Property Level Authorization.
 * Nothing reaches the client except the properties listed here. Ciphertext,
 * blind indexes, Mongo internals and provenance ids are never serialised, and
 * the mapper is the ONLY place a decrypted value becomes an HTTP response.
 */
import { decryptField } from '../services/crypto.service.js';

/** `FR7630003123456789012` -> `FR76 **** **** 9012` */
export function maskAccountNumber(accountNumber) {
  const value = String(accountNumber ?? '');
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)} **** **** ${value.slice(-4)}`;
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email ?? '').split('@');
  if (!domain) return '****';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}

/** Money is stored in minor units; expose both so the client never rounds. */
function money(balanceMinor, currency) {
  return {
    amountMinor: balanceMinor,
    amount: Number((balanceMinor / 100).toFixed(2)),
    currency,
  };
}

/**
 * Compact projection used by the list endpoint. Account number and e-mail are
 * masked - a list view has no business exposing full identifiers, and it keeps
 * bulk scraping of the collection worthless (data minimisation).
 */
export function toAccountSummary(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id ?? doc.id),
    accountNumberMasked: maskAccountNumber(decryptField(doc.accountNumberEnc)),
    holderName: decryptField(doc.holderNameEnc),
    emailMasked: maskEmail(decryptField(doc.emailEnc)),
    accountType: doc.accountType,
    status: doc.status,
    branchCode: doc.branchCode,
    balance: money(doc.balanceMinor, doc.currency),
    openedAt: doc.openedAt,
    updatedAt: doc.updatedAt,
    version: doc.version ?? 0,
  };
}

/** Full projection used by the single-account endpoints. */
export function toAccountDetail(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id ?? doc.id),
    accountNumber: decryptField(doc.accountNumberEnc),
    accountNumberMasked: maskAccountNumber(decryptField(doc.accountNumberEnc)),
    holderName: decryptField(doc.holderNameEnc),
    email: decryptField(doc.emailEnc),
    phone: decryptField(doc.phoneEnc),
    address: decryptField(doc.addressEnc),
    accountType: doc.accountType,
    status: doc.status,
    branchCode: doc.branchCode,
    balance: money(doc.balanceMinor, doc.currency),
    openedAt: doc.openedAt,
    closedAt: doc.closedAt ?? null,
    closureReason: doc.closureReason ?? null,
    isDeleted: Boolean(doc.isDeleted),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    version: doc.version ?? 0,
  };
}

export function toUserProfile(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id ?? doc.id),
    email: decryptField(doc.emailEnc),
    displayName: doc.displayName,
    role: doc.role,
    mustChangePassword: Boolean(doc.mustChangePassword),
    lastLoginAt: doc.lastLoginAt ?? null,
    failedSinceLastLogin: doc.failedSinceLastLogin ?? 0,
  };
}

export function toAuditEntry(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id ?? doc.id),
    action: doc.action,
    outcome: doc.outcome,
    actorId: doc.actorId ? String(doc.actorId) : null,
    actorRole: doc.actorRole,
    subjectType: doc.subjectType,
    subjectId: doc.subjectId,
    correlationId: doc.correlationId,
    metadata: doc.metadata ?? {},
    occurredAt: doc.occurredAt,
  };
}

export default { toAccountSummary, toAccountDetail, toUserProfile, toAuditEntry, maskAccountNumber };
