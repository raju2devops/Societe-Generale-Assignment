/**
 * Account controller - HTTP translation only.
 *
 * Reads validated input off `req`, calls a service method, maps the result
 * through a DTO. No business rules, no database access, no crypto. That
 * separation is what lets the same services back a CLI, a queue consumer or a
 * gRPC facade without a rewrite.
 */
import { toAccountDetail, toAccountSummary } from '../dto/account.dto.js';

export function createAccountController({ accountService }) {
  return {
    async create(req, res) {
      const account = await accountService.create({
        actor: req.actor,
        payload: req.body,
        correlationId: req.correlationId,
      });
      const dto = toAccountDetail(account);
      res.status(201).location(`/api/v1/accounts/${dto.id}`).json({ data: dto });
    },

    async list(req, res) {
      const { items, total, page, pageSize } = await accountService.list({
        actor: req.actor,
        query: req.query,
      });
      res.status(200).json({
        data: items.map(toAccountSummary),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      });
    },

    async getById(req, res) {
      const account = await accountService.getById({
        actor: req.actor,
        id: req.params.id,
        correlationId: req.correlationId,
      });
      res.status(200).json({ data: toAccountDetail(account) });
    },

    async getByAccountNumber(req, res) {
      const account = await accountService.getByAccountNumber({
        actor: req.actor,
        accountNumber: req.params.accountNumber,
        correlationId: req.correlationId,
      });
      res.status(200).json({ data: toAccountDetail(account) });
    },

    async update(req, res) {
      const account = await accountService.update({
        actor: req.actor,
        id: req.params.id,
        payload: req.body,
        correlationId: req.correlationId,
      });
      res.status(200).json({ data: toAccountDetail(account) });
    },

    async changeStatus(req, res) {
      const account = await accountService.changeStatus({
        actor: req.actor,
        id: req.params.id,
        payload: req.body,
        correlationId: req.correlationId,
      });
      res.status(200).json({ data: toAccountDetail(account) });
    },

    async close(req, res) {
      const account = await accountService.close({
        actor: req.actor,
        id: req.params.id,
        payload: req.body,
        correlationId: req.correlationId,
      });
      res.status(200).json({ data: toAccountDetail(account) });
    },

    async purge(req, res) {
      await accountService.purge({
        actor: req.actor,
        id: req.params.id,
        correlationId: req.correlationId,
      });
      res.status(204).send();
    },
  };
}

export default createAccountController;
