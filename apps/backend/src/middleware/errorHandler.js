/**
 * Central error handler + 404 handler.
 *
 * OWASP A10:2025 (Mishandling of Exceptional Conditions) and the Mandatory
 * Control "User-friendly error responses - no internal details".
 *
 * Contract:
 *   * The response body NEVER contains a stack trace, a driver message, a file
 *     path or a query. Only `code`, a safe `message`, the correlation id, and -
 *     for 400s only - the list of offending field names.
 *   * The full detail goes to the log, once, with the correlation id, so
 *     support can join the two without the client ever seeing internals.
 *   * Anything that is not an AppError is treated as a 500 with a fixed
 *     message: an unexpected exception must not become an information leak.
 */
import { AppError, NotFoundError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

/** Translate known third-party failures into safe domain errors. */
function normalise(err) {
  if (err instanceof AppError) return err;

  // Mongo duplicate key - do not echo the key or its value back.
  if (err?.code === 11000) {
    return new AppError('That value is already in use.', {
      status: 409,
      code: 'DUPLICATE_KEY',
      logDetail: `mongo duplicate key on ${Object.keys(err.keyPattern ?? {}).join(',')}`,
    });
  }

  if (err?.name === 'VersionError') {
    return new AppError('This record was modified by someone else. Reload and try again.', {
      status: 409,
      code: 'CONFLICT',
      logDetail: 'mongoose optimistic concurrency version error',
    });
  }

  // express.json() body-parser failures (malformed JSON, body too large).
  if (err?.type === 'entity.too.large') {
    return new AppError('Request body is too large.', {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      logDetail: 'body exceeded configured limit',
    });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return new AppError('Malformed JSON in the request body.', {
      status: 400,
      code: 'MALFORMED_JSON',
      logDetail: 'JSON parse failure',
    });
  }

  if (err?.message === 'CORS_ORIGIN_NOT_ALLOWED') {
    return new AppError('Origin is not permitted.', {
      status: 403,
      code: 'CORS_DENIED',
      logDetail: 'request from a non allow-listed origin',
    });
  }

  return new AppError('An unexpected error occurred. Please try again later.', {
    status: 500,
    code: 'INTERNAL_ERROR',
    logDetail: err?.message,
  });
}

export function notFoundHandler(req, _res, next) {
  next(new NotFoundError('Endpoint', `no route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies the error
// handler by its 4-argument arity; `next` must stay in the signature.
export function errorHandler(err, req, res, next) {
  const appError = normalise(err);
  const correlationId = req.correlationId ?? null;

  const logPayload = {
    correlationId,
    code: appError.code,
    status: appError.status,
    method: req.method,
    path: req.path,
    actorId: req.actor?.id ? String(req.actor.id) : null,
    detail: appError.logDetail,
    // Stack only for genuine server faults, and only ever into the log.
    ...(appError.status >= 500 ? { stack: err?.stack } : {}),
  };

  if (appError.status >= 500) logger.error(logPayload, 'request_failed');
  else logger.warn(logPayload, 'request_rejected');

  if (res.headersSent) return next(err);

  return res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      correlationId,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
}

export default { errorHandler, notFoundHandler };
