/**
 * Mongoose schema for a bank account.
 *
 * Every PII / identifying field is stored ONLY as an AES-256-GCM envelope
 * (`*Enc`). The plaintext never touches the database. Fields that must remain
 * searchable carry an additional keyed blind index (`*Index`) - see
 * services/crypto.service.js.
 *
 * Money is stored as an integer number of MINOR units (cents). Floating point
 * is never used for balances.
 */
import mongoose from 'mongoose';
import { ACCOUNT_TYPES, ACCOUNT_STATUSES, CURRENCIES } from '../domain/constants.js';

const accountSchema = new mongoose.Schema(
  {
    // --- Encrypted identifying data -----------------------------------------
    accountNumberEnc: { type: String, required: true },
    accountNumberIndex: { type: String, required: true, unique: true, index: true },

    holderNameEnc: { type: String, required: true },

    emailEnc: { type: String, required: true },
    emailIndex: { type: String, required: true, index: true },

    phoneEnc: { type: String, default: null },
    addressEnc: { type: String, default: null },

    // --- Non-identifying operational data -----------------------------------
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true },
    currency: { type: String, enum: CURRENCIES, required: true, default: 'EUR' },
    balanceMinor: { type: Number, required: true, default: 0, min: 0 },
    status: { type: String, enum: ACCOUNT_STATUSES, required: true, default: 'ACTIVE', index: true },
    branchCode: { type: String, required: true, match: /^[A-Z0-9]{4,10}$/ },
    openedAt: { type: Date, required: true, default: () => new Date() },

    // --- Provenance / soft delete -------------------------------------------
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closureReason: { type: String, default: null, maxlength: 500 },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    // Optimistic concurrency: a stale client PUT is rejected with a version
    // conflict rather than silently clobbering a concurrent update.
    optimisticConcurrency: true,
    versionKey: 'version',
    minimize: false,
  }
);

// Compound index supporting the default "active accounts, newest first" listing.
accountSchema.index({ isDeleted: 1, status: 1, createdAt: -1 });

/**
 * Defence in depth: even if a caller forgets the DTO mapper, a raw
 * `toJSON()` never emits ciphertext or Mongo internals.
 */
accountSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.accountNumberEnc;
    delete ret.accountNumberIndex;
    delete ret.holderNameEnc;
    delete ret.emailEnc;
    delete ret.emailIndex;
    delete ret.phoneEnc;
    delete ret.addressEnc;
    delete ret._id;
    return ret;
  },
});

export const AccountModel = mongoose.model('Account', accountSchema);
export default AccountModel;
