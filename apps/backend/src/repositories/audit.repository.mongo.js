/** MongoDB implementation of the AuditRepository port (append-only). */
import { AuditLogModel } from '../models/auditLog.model.js';
import { PAGINATION } from '../domain/constants.js';

export function createMongoAuditRepository({ model = AuditLogModel } = {}) {
  return {
    async append(entry) {
      const created = await model.create(entry);
      return created.toObject();
    },

    async findMany(criteria = {}, paging = {}) {
      const page = Math.max(1, Number(paging.page) || 1);
      const pageSize = Math.min(
        PAGINATION.MAX_PAGE_SIZE,
        Math.max(1, Number(paging.pageSize) || PAGINATION.DEFAULT_PAGE_SIZE)
      );
      const filter = {};
      if (criteria.action) filter.action = criteria.action;
      if (criteria.subjectId) filter.subjectId = String(criteria.subjectId);

      const [items, total] = await Promise.all([
        model
          .find(filter)
          .sort({ occurredAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        model.countDocuments(filter),
      ]);
      return { items, total, page, pageSize };
    },
  };
}

export default createMongoAuditRepository;
