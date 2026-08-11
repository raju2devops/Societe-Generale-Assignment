/**
 * In-memory implementations of the four repository ports.
 *
 * These exist to prove the point of the architecture: the services, controllers,
 * middleware, validation and error handling are all exercised at the HTTP level
 * with zero MongoDB involved, purely by handing `buildContainer()` a different
 * set of adapters. If a business rule ever leaks into a repository, these tests
 * stop passing.
 */
import crypto from 'node:crypto';
import { PAGINATION } from '../../src/domain/constants.js';

const newId = () => crypto.randomBytes(12).toString('hex'); // 24 hex chars, ObjectId-shaped
const clone = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : doc);

export function createInMemoryAccountRepository() {
  const store = new Map();

  return {
    _store: store,

    async create(doc) {
      const _id = newId();
      const record = {
        ...doc,
        _id,
        version: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(_id, record);
      return clone(record);
    },

    async findById(id, { includeDeleted = false } = {}) {
      const doc = store.get(String(id));
      if (!doc) return null;
      if (!includeDeleted && doc.isDeleted) return null;
      return clone(doc);
    },

    async findByAccountNumberIndex(index, { includeDeleted = false } = {}) {
      for (const doc of store.values()) {
        if (doc.accountNumberIndex === index && (includeDeleted || !doc.isDeleted)) {
          return clone(doc);
        }
      }
      return null;
    },

    async existsByAccountNumberIndex(index) {
      for (const doc of store.values()) if (doc.accountNumberIndex === index) return true;
      return false;
    },

    async findMany(criteria = {}, paging = {}) {
      const page = Math.max(1, Number(paging.page) || 1);
      const pageSize = Math.min(
        PAGINATION.MAX_PAGE_SIZE,
        Math.max(1, Number(paging.pageSize) || PAGINATION.DEFAULT_PAGE_SIZE)
      );

      let items = [...store.values()].filter((d) =>
        criteria.includeDeleted === true ? true : !d.isDeleted
      );
      for (const key of ['status', 'accountType', 'currency', 'branchCode', 'accountNumberIndex', 'emailIndex']) {
        if (criteria[key]) items = items.filter((d) => d[key] === criteria[key]);
      }

      const [sortKey, dir] = Object.entries(paging.sort ?? { createdAt: -1 })[0];
      items.sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * dir;
      });

      const total = items.length;
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize).map(clone),
        total,
        page,
        pageSize,
      };
    },

    async updateById(id, patch, { expectedVersion } = {}) {
      const doc = store.get(String(id));
      if (!doc || doc.isDeleted) return null;
      if (expectedVersion !== undefined && expectedVersion !== null && doc.version !== Number(expectedVersion)) {
        return null;
      }
      Object.assign(doc, patch, { version: doc.version + 1, updatedAt: new Date().toISOString() });
      return clone(doc);
    },

    async softDeleteById(id, { closedBy, closureReason, expectedVersion } = {}) {
      const doc = store.get(String(id));
      if (!doc || doc.isDeleted) return null;
      if (expectedVersion !== undefined && expectedVersion !== null && doc.version !== Number(expectedVersion)) {
        return null;
      }
      Object.assign(doc, {
        isDeleted: true,
        status: 'CLOSED',
        closedAt: new Date().toISOString(),
        closedBy,
        closureReason: closureReason ?? null,
        version: doc.version + 1,
      });
      return clone(doc);
    },

    async hardDeleteById(id) {
      const doc = store.get(String(id));
      store.delete(String(id));
      return clone(doc ?? null);
    },
  };
}

export function createInMemoryUserRepository() {
  const store = new Map();
  return {
    _store: store,
    async create(doc) {
      const _id = newId();
      const record = { ...doc, _id, version: 0 };
      store.set(_id, record);
      return clone(record);
    },
    async findByEmailIndex(emailIndex) {
      for (const doc of store.values()) if (doc.emailIndex === emailIndex) return clone(doc);
      return null;
    },
    async findById(id) {
      return clone(store.get(String(id)) ?? null);
    },
    async updateById(id, patch) {
      const doc = store.get(String(id));
      if (!doc) return null;
      Object.assign(doc, patch);
      return clone(doc);
    },
    async countAll() {
      return store.size;
    },
  };
}

export function createInMemorySessionRepository() {
  const store = new Map();
  return {
    _store: store,
    async create(doc) {
      const _id = newId();
      const record = { ...doc, _id, revokedAt: null, revokedReason: null };
      store.set(_id, record);
      return clone(record);
    },
    async findActiveByTokenHash(tokenHash) {
      for (const doc of store.values()) {
        if (doc.tokenHash === tokenHash && !doc.revokedAt && new Date(doc.expiresAt) > new Date()) {
          return clone(doc);
        }
      }
      return null;
    },
    async findAnyByTokenHash(tokenHash) {
      for (const doc of store.values()) if (doc.tokenHash === tokenHash) return clone(doc);
      return null;
    },
    async touch(id, when = new Date()) {
      const doc = store.get(String(id));
      if (doc) doc.lastUsedAt = when;
      return clone(doc ?? null);
    },
    async revokeById(id, reason) {
      const doc = store.get(String(id));
      if (doc) {
        doc.revokedAt = new Date();
        doc.revokedReason = reason;
      }
      return clone(doc ?? null);
    },
    async revokeFamily(familyId, reason) {
      let n = 0;
      for (const doc of store.values()) {
        if (doc.familyId === familyId && !doc.revokedAt) {
          doc.revokedAt = new Date();
          doc.revokedReason = reason;
          n += 1;
        }
      }
      return n;
    },
    async revokeAllForUser(userId, reason) {
      let n = 0;
      for (const doc of store.values()) {
        if (String(doc.userId) === String(userId) && !doc.revokedAt) {
          doc.revokedAt = new Date();
          doc.revokedReason = reason;
          n += 1;
        }
      }
      return n;
    },
  };
}

export function createInMemoryAuditRepository() {
  const entries = [];
  return {
    _entries: entries,
    async append(entry) {
      const record = { ...entry, _id: newId() };
      entries.push(record);
      return clone(record);
    },
    async findMany(criteria = {}, paging = {}) {
      let items = [...entries];
      if (criteria.action) items = items.filter((e) => e.action === criteria.action);
      if (criteria.subjectId) items = items.filter((e) => e.subjectId === String(criteria.subjectId));
      const page = Math.max(1, Number(paging.page) || 1);
      const pageSize = Math.min(PAGINATION.MAX_PAGE_SIZE, Number(paging.pageSize) || PAGINATION.DEFAULT_PAGE_SIZE);
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize).map(clone),
        total: items.length,
        page,
        pageSize,
      };
    },
  };
}

export default {
  createInMemoryAccountRepository,
  createInMemoryUserRepository,
  createInMemorySessionRepository,
  createInMemoryAuditRepository,
};
