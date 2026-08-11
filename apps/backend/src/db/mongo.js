/**
 * MongoDB connection.
 *
 * Mandatory Controls: "Secure database configuration - encryption at rest,
 * access control, secure connections", "Restrict web-server privileges - never
 * connect to the DB as DBADMIN".
 *
 * The URI must name a least-privilege application user with `readWrite` on the
 * application database only. docker-compose provisions exactly that user; the
 * root credential is used once, at first boot, and never by the running
 * service.
 */
import fs from 'node:fs';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

let connected = false;

export async function connectMongo() {
  mongoose.set('strictQuery', true);
  // Reject any query object carrying a `$` operator that was not built by this
  // codebase. Combined with zod validation this closes NoSQL operator injection.
  mongoose.set('sanitizeFilter', true);

  const options = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 20_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    retryWrites: true,
    // Reads and writes must be acknowledged by a majority - a rolled-back write
    // in a replica-set failover would silently lose an account.
    writeConcern: { w: 'majority' },
    readConcern: { level: 'majority' },
    autoIndex: !config.isProduction, // indexes are applied by a migration in prod
  };

  if (config.mongo.tls) {
    options.tls = true;
    // Never disable certificate validation. If TLS is on, it is validated.
    options.tlsAllowInvalidCertificates = false;
    options.tlsAllowInvalidHostnames = false;

    // Only pin a CA bundle when one is actually supplied. A managed provider
    // such as Atlas uses a public CA that Node already trusts; forcing a bundle
    // path there would mean inventing a file that does not need to exist.
    if (config.mongo.caFile) {
      if (!fs.existsSync(config.mongo.caFile)) {
        throw new Error(`MONGODB_CA_FILE does not exist: ${config.mongo.caFile}`);
      }
      options.tlsCAFile = config.mongo.caFile;
    }
  }

  // Note: a `mongodb+srv://` URI (Atlas and most managed providers) enables TLS
  // at the driver level on its own, regardless of the flag above.

  mongoose.connection.on('connected', () => {
    connected = true;
    logger.info('mongo_connected');
  });
  mongoose.connection.on('disconnected', () => {
    connected = false;
    logger.warn('mongo_disconnected');
  });
  mongoose.connection.on('error', (err) => {
    connected = false;
    // The URI contains a password - log the driver message only, never the URI.
    logger.error({ err: err.message }, 'mongo_error');
  });

  await mongoose.connect(config.mongo.uri, options);
  return mongoose.connection;
}

export function isMongoReady() {
  return connected && mongoose.connection.readyState === 1;
}

export async function disconnectMongo() {
  await mongoose.connection.close();
  connected = false;
}

export default { connectMongo, disconnectMongo, isMongoReady };
