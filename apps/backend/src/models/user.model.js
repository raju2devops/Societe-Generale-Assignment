/**
 * Operator account (the humans who use the back office).
 *
 * Mandatory Controls implemented on this schema:
 *   - "Store non-reversible password hashes"          -> passwordHash (scrypt)
 *   - "Password history - last 10, no re-use"         -> passwordHistory
 *   - "Lock account after 3 failed attempts"          -> failedAttempts / lockedUntil
 *   - "Inform the user of last successful login"      -> lastLoginAt / failedSinceLastLogin
 *   - "Passwords expire after 90 days"                -> passwordChangedAt
 */
import mongoose from 'mongoose';
import { ALL_ROLES, ROLES } from '../domain/constants.js';

const userSchema = new mongoose.Schema(
  {
    emailEnc: { type: String, required: true },
    emailIndex: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: 120 },

    passwordHash: { type: String, required: true },
    passwordHistory: { type: [String], default: [] },
    passwordChangedAt: { type: Date, default: () => new Date() },
    mustChangePassword: { type: Boolean, default: false },

    role: { type: String, enum: ALL_ROLES, required: true, default: ROLES.VIEWER },
    isActive: { type: Boolean, default: true },

    failedAttempts: { type: Number, default: 0 },
    failedSinceLastLogin: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: 'version' }
);

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.passwordHistory;
    delete ret.emailEnc;
    delete ret.emailIndex;
    delete ret._id;
    return ret;
  },
});

export const UserModel = mongoose.model('User', userSchema);
export default UserModel;
