/** MongoDB implementation of the SessionRepository port. */
import mongoose from 'mongoose';
import { SessionModel } from '../models/session.model.js';

export function createMongoSessionRepository({ model = SessionModel } = {}) {
  return {
    async create(doc) {
      const created = await model.create(doc);
      return created.toObject();
    },

    async findActiveByTokenHash(tokenHash) {
      return model
        .findOne({
          tokenHash: String(tokenHash),
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        })
        .lean();
    },

    /**
     * Look up a session regardless of state. Used only to detect replay of an
     * already-rotated refresh token so the whole family can be burned.
     */
    async findAnyByTokenHash(tokenHash) {
      return model.findOne({ tokenHash: String(tokenHash) }).lean();
    },

    async touch(id, when = new Date()) {
      return model.findByIdAndUpdate(id, { $set: { lastUsedAt: when } }, { new: true }).lean();
    },

    async revokeById(id, reason) {
      return model
        .findByIdAndUpdate(
          id,
          { $set: { revokedAt: new Date(), revokedReason: String(reason).slice(0, 120) } },
          { new: true }
        )
        .lean();
    },

    /**
     * Kill an entire refresh-token family. Called when a rotated token is
     * replayed, which is the classic signal of a stolen refresh token.
     */
    async revokeFamily(familyId, reason) {
      const res = await model.updateMany(
        { familyId: String(familyId), revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: String(reason).slice(0, 120) } }
      );
      return res.modifiedCount ?? 0;
    },

    async revokeAllForUser(userId, reason) {
      if (!mongoose.Types.ObjectId.isValid(String(userId))) return 0;
      const res = await model.updateMany(
        { userId: new mongoose.Types.ObjectId(String(userId)), revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: String(reason).slice(0, 120) } }
      );
      return res.modifiedCount ?? 0;
    },
  };
}

export default createMongoSessionRepository;
