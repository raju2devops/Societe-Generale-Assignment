/**
 * Append-only audit trail.
 *
 * Mandatory Controls / OWASP A09:2025: log failed authentication, access-control
 * violations, rejected user actions and all administrative actions. Logs are
 * classified CRITICAL - in a hardened deployment this collection should be
 * granted insert-only rights via a custom database role, so a compromised
 * application cannot rewrite or erase its own trail. Nothing in the application
 * ever issues an update or a delete against it.
 *
 * Only *references* are stored (account id, actor id). No PII, no account
 * numbers, no balances.
 */
import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../domain/constants.js';

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, enum: Object.values(AUDIT_ACTIONS), required: true, index: true },
    outcome: { type: String, enum: ['SUCCESS', 'FAILURE'], required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorRole: { type: String, default: null },
    subjectType: { type: String, default: null },
    subjectId: { type: String, default: null, index: true },
    correlationId: { type: String, default: null, index: true },
    /** Free-form, PII-free context (e.g. which fields changed - not their values). */
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, default: () => new Date(), index: true },
  },
  { versionKey: false, capped: false }
);

export const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);
export default AuditLogModel;
