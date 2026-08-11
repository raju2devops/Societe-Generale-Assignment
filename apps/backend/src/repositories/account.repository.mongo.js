/**
 * MongoDB implementation of the AccountRepository port.
 *
 * The service layer depends on the *shape* of this object, never on Mongoose.
 * Swapping in PostgreSQL, or the in-memory double used by the test-suite, means
 * providing another object with the same methods - nothing above this file
 * changes (loosely coupled architecture).
 *
 * All queries are built from typed, validated values; no string concatenation
 * and no `$where` / `$expr` with user input, so operator injection
 * (OWASP A05:2025) is structurally impossible here.
 */
import mongoose from 'mongoose';
import { AccountModel } from '../models/account.model.js';
import { PAGINATION } from '../domain/constants.js';

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));

export function createMongoAccountRepository({ model = AccountModel } = {}) {
  return {
    async create(doc) {
      const created = await model.create(doc);
      return created.toObject();
    },

    async findById(id, { includeDeleted = false } = {}) {
      if (!isValidId(id)) return null;
      const filter = { _id: new mongoose.Types.ObjectId(String(id)) };
      if (!includeDeleted) filter.isDeleted = false;
      return model.findOne(filter).lean();
    },

    async findByAccountNumberIndex(index, { includeDeleted = false } = {}) {
      const filter = { accountNumberIndex: String(index) };
      if (!includeDeleted) filter.isDeleted = false;
      return model.findOne(filter).lean();
    },

    async existsByAccountNumberIndex(index) {
      return Boolean(await model.exists({ accountNumberIndex: String(index) }));
    },

    /**
     * @param {object} criteria - already-validated filter values
     * @param {object} paging   - { page, pageSize, sort }
     */
    async findMany(criteria = {}, paging = {}) {
      const page = Math.max(1, Number(paging.page) || 1);
      const pageSize = Math.min(
        PAGINATION.MAX_PAGE_SIZE,
        Math.max(1, Number(paging.pageSize) || PAGINATION.DEFAULT_PAGE_SIZE)
      );

      const filter = { isDeleted: criteria.includeDeleted === true ? { $in: [true, false] } : false };
      if (criteria.status) filter.status = criteria.status;
      if (criteria.accountType) filter.accountType = criteria.accountType;
      if (criteria.currency) filter.currency = criteria.currency;
      if (criteria.branchCode) filter.branchCode = criteria.branchCode;
      if (criteria.accountNumberIndex) filter.accountNumberIndex = criteria.accountNumberIndex;
      if (criteria.emailIndex) filter.emailIndex = criteria.emailIndex;

      // Sort key comes from a closed allow-list in the validation layer.
      const sort = paging.sort ?? { createdAt: -1 };

      const [items, total] = await Promise.all([
        model
          .find(filter)
          .sort(sort)
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        model.countDocuments(filter),
      ]);

      return { items, total, page, pageSize };
    },

    /**
     * Version-checked update. Returns null when the document does not exist OR
     * when the caller's `expectedVersion` is stale, letting the service raise a
     * 409 instead of overwriting a concurrent change.
     */
    async updateById(id, patch, { expectedVersion } = {}) {
      if (!isValidId(id)) return null;
      const filter = { _id: new mongoose.Types.ObjectId(String(id)), isDeleted: false };
      if (expectedVersion !== undefined && expectedVersion !== null) {
        filter.version = Number(expectedVersion);
      }
      return model
        .findOneAndUpdate(filter, { $set: patch, $inc: { version: 1 } }, { new: true })
        .lean();
    },

    /** Soft delete - the record is retained for audit and regulatory retention. */
    async softDeleteById(id, { closedBy, closureReason, expectedVersion } = {}) {
      if (!isValidId(id)) return null;
      const filter = { _id: new mongoose.Types.ObjectId(String(id)), isDeleted: false };
      if (expectedVersion !== undefined && expectedVersion !== null) {
        filter.version = Number(expectedVersion);
      }
      return model
        .findOneAndUpdate(
          filter,
          {
            $set: {
              isDeleted: true,
              status: 'CLOSED',
              closedAt: new Date(),
              closedBy,
              closureReason: closureReason ?? null,
            },
            $inc: { version: 1 },
          },
          { new: true }
        )
        .lean();
    },

    /** Irreversible erasure - admin only, used for GDPR Art.17 requests. */
    async hardDeleteById(id) {
      if (!isValidId(id)) return null;
      return model.findOneAndDelete({ _id: new mongoose.Types.ObjectId(String(id)) }).lean();
    },
  };
}

export default createMongoAccountRepository;
