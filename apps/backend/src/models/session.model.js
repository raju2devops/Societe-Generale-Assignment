/**
 * Server-side refresh-token session record.
 *
 * Mandatory Controls: "Disallow user-chosen Session IDs", "Session IDs are long,
 * complex and random", "Change session IDs during major transitions",
 * "Implement connection time-outs".
 *
 * The raw refresh token is NEVER stored - only its SHA-256 fingerprint, so a
 * database dump cannot be replayed against the API.
 */
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    familyId: { type: String, required: true, index: true },
    issuedAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true, default: () => new Date() },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    // Coarse client fingerprint. Hashed - we never persist a raw UA/IP pair
    // against a user record (data minimisation, GDPR).
    clientFingerprint: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);

// MongoDB TTL index - expired sessions are reaped by the server itself, so a
// crashed cleanup job can never leave a live session behind.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel = mongoose.model('Session', sessionSchema);
export default SessionModel;
