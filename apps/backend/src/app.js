/**
 * Express application assembly.
 *
 * Middleware order matters and is deliberate:
 *   1. trust proxy      - so req.ip is the real client behind the nginx proxy
 *   2. helmet           - security headers before anything can respond
 *   3. correlation id   - so every later log line and error carries it
 *   4. cors             - allow-list check before the body is even parsed
 *   5. body/cookie parse with hard size limits
 *   6. rate limiting
 *   7. routes (each with its own authn -> authz -> validation chain)
 *   8. 404 -> central error handler
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import pinoHttp from 'pino-http';

import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { correlationId } from './middleware/correlationId.js';
import { globalLimiter } from './middleware/rateLimiters.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createApiRouter } from './routes/index.js';

export function createApp(container) {
  const app = express();

  // A specific hop count - never `true` - so a client cannot spoof
  // X-Forwarded-For and defeat the per-IP rate limiter. Configured per
  // environment because the answer differs: 0 running locally, 2 behind the
  // Azure load balancer plus the web pod's nginx. See TRUST_PROXY_HOPS in
  // config/env.js.
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by'); // do not advertise the framework (A02:2025)
  app.set('etag', false); // no conditional caching of authenticated payloads

  app.use(
    helmet({
      // This service serves JSON only; the CSP is a belt-and-braces default in
      // case an error page or a future doc route ever renders HTML. The SPA
      // ships its own, stricter policy from nginx (frontend/nginx.conf).
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: config.isProduction
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      noSniff: true,
      frameguard: { action: 'deny' },
    })
  );

  app.use(correlationId);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.correlationId,
      // Health checks would otherwise drown the signal.
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / server-to-server requests carry no Origin header.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
      },
      credentials: true, // required for the auth cookies; safe only because the
      // origin list above is an explicit allow-list, never '*'
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-csrf-token', 'x-correlation-id'],
      exposedHeaders: ['x-correlation-id'],
      maxAge: 600,
    })
  );

  // Compression is skipped on the authentication routes. Those responses carry
  // a CSRF token alongside caller-influenced data, and compressing the two
  // together is precisely the condition BREACH exploits.
  app.use(
    compression({
      filter: (req, res) =>
        !req.path.startsWith('/api/v1/auth') && compression.filter(req, res),
    })
  );

  // Hard body limits - an unbounded parser is a free denial-of-service
  // (OWASP API4:2023).
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(cookieParser());

  app.use(globalLimiter);

  // Liveness / readiness. Deliberately free of version or build detail - a
  // health endpoint must not fingerprint the deployment.
  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/readyz', (_req, res) =>
    res.status(container.isReady?.() === false ? 503 : 200).json({
      status: container.isReady?.() === false ? 'degraded' : 'ok',
    })
  );

  app.use('/api/v1', createApiRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
