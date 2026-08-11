/** MongoDB implementation of the UserRepository port. */
import mongoose from 'mongoose';
import { UserModel } from '../models/user.model.js';

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));

export function createMongoUserRepository({ model = UserModel } = {}) {
  return {
    async create(doc) {
      const created = await model.create(doc);
      return created.toObject();
    },

    async findByEmailIndex(emailIndex) {
      return model.findOne({ emailIndex: String(emailIndex) }).lean();
    },

    async findById(id) {
      if (!isValidId(id)) return null;
      return model.findById(new mongoose.Types.ObjectId(String(id))).lean();
    },

    async updateById(id, patch) {
      if (!isValidId(id)) return null;
      return model
        .findByIdAndUpdate(new mongoose.Types.ObjectId(String(id)), { $set: patch }, { new: true })
        .lean();
    },

    async countAll() {
      return model.estimatedDocumentCount();
    },
  };
}

export default createMongoUserRepository;
