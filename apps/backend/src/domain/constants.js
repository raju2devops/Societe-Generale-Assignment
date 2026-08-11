/**
 * Domain constants shared by the validation, service and persistence layers.
 * Kept free of any framework import so the domain stays portable (loose
 * coupling - the same constants are consumed by the in-memory test repository
 * and by Mongoose alike).
 */

export const ROLES = Object.freeze({
  VIEWER: 'viewer',
  OFFICER: 'officer',
  ADMIN: 'admin',
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

/** Coarse-grained permissions. Roles map to permissions, routes require permissions. */
export const PERMISSIONS = Object.freeze({
  ACCOUNT_READ: 'account:read',
  ACCOUNT_CREATE: 'account:create',
  ACCOUNT_UPDATE: 'account:update',
  ACCOUNT_DELETE: 'account:delete',
  ACCOUNT_PURGE: 'account:purge',
  AUDIT_READ: 'audit:read',
});

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.VIEWER]: Object.freeze([PERMISSIONS.ACCOUNT_READ]),
  [ROLES.OFFICER]: Object.freeze([
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.ACCOUNT_CREATE,
    PERMISSIONS.ACCOUNT_UPDATE,
  ]),
  [ROLES.ADMIN]: Object.freeze([
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.ACCOUNT_CREATE,
    PERMISSIONS.ACCOUNT_UPDATE,
    PERMISSIONS.ACCOUNT_DELETE,
    PERMISSIONS.ACCOUNT_PURGE,
    PERMISSIONS.AUDIT_READ,
  ]),
});

export const ACCOUNT_TYPES = Object.freeze(['SAVINGS', 'CURRENT', 'FIXED_DEPOSIT', 'JOINT']);

export const ACCOUNT_STATUSES = Object.freeze(['ACTIVE', 'DORMANT', 'FROZEN', 'CLOSED']);

export const CURRENCIES = Object.freeze(['EUR', 'USD', 'GBP', 'INR', 'CHF']);

/** Blind-index namespaces - keeps the same value in two fields from colliding. */
export const INDEX_DOMAINS = Object.freeze({
  ACCOUNT_NUMBER: 'account.accountNumber',
  ACCOUNT_EMAIL: 'account.email',
  USER_EMAIL: 'user.email',
});

export const AUDIT_ACTIONS = Object.freeze({
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  ACCOUNT_VIEWED: 'ACCOUNT_VIEWED',
  ACCOUNT_UPDATED: 'ACCOUNT_UPDATED',
  ACCOUNT_CLOSED: 'ACCOUNT_CLOSED',
  ACCOUNT_PURGED: 'ACCOUNT_PURGED',
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  LOGOUT: 'LOGOUT',
  ACCESS_DENIED: 'ACCESS_DENIED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
});

export const PAGINATION = Object.freeze({
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 50, // OWASP API4:2023 - cap page size, no unbounded reads
});

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role, permission) {
  return permissionsForRole(role).includes(permission);
}
