/**
 * Process entry point.
 *
 * Fail securely (principle #5): if the database is unreachable at boot the
 * process exits rather than starting and serving 500s from a half-initialised
 * state. Graceful shutdown drains in-flight requests so a restart or redeploy
 * does not truncate a write.
 */
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { connectMongo, disconnectMongo, isMongoReady } from './db/mongo.js';
import { buildContainer } from './container.js';
import { createApp } from './app.js';

const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  await connectMongo();

  const container = buildContainer();
  container.isReady = isMongoReady;

  const app = createApp(container);
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env, authMode: config.auth.mode }, 'server_started');
  });

  // Slowloris mitigation - a connection that never finishes its headers is
  // dropped rather than held open for free.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 15_000;

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown_started');

    const forceExit = setTimeout(() => {
      logger.error('shutdown_forced');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    server.close(async () => {
      try {
        await disconnectMongo();
        logger.info('shutdown_complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err: err.message }, 'shutdown_error');
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // An unhandled rejection or uncaught exception leaves the process in an
  // unknown state. Log it and die - the container runtime restarts a clean
  // instance. Continuing would violate "fail securely".
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason: String(reason) }, 'unhandled_rejection');
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'uncaught_exception');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'startup_failed');
  process.exit(1);
});
