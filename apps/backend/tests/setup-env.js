/**
 * Test environment bootstrap.
 *
 * Keys are generated per run and exist only in this process's memory - the test
 * suite never ships a fixed key, so there is nothing here for a scanner to
 * flag as a committed secret and nothing an operator could accidentally
 * promote to an environment.
 */
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
process.env.MONGODB_URI = 'mongodb://localhost:27017/sgbank_test';
process.env.MONGODB_TLS = 'false';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.FIELD_ENC_KEY = crypto.randomBytes(32).toString('hex');
process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString('hex');
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.AUTH_MODE = 'local';
