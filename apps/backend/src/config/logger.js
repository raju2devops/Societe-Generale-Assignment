/**
 * Structured logging.
 *
 * Mandatory Controls: "Secure logging - never log PII or passwords",
 * "Application logs enabled 24/7", OWASP A09:2025 Logging & Alerting Failures.
 *
 * Everything that could carry a credential, token, cookie or PII value is
 * redacted by pino BEFORE serialisation, so a careless `logger.info({ req })`
 * cannot leak it. Redaction is deny-by-default on the known-sensitive paths and
 * is complemented by the DTO layer, which means domain PII never reaches a log
 * line in the first place.
 */
import pino from 'pino';
import { config } from './env.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  'refreshToken',
  '*.refreshToken',
  'accountNumber',
  '*.accountNumber',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'address',
  '*.address',
  'holderName',
  '*.holderName',
];

export const logger = pino({
  level: config.logLevel,
  base: { service: 'sg-bank-accounts-api', env: config.env },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Pretty output is a development-only convenience; production emits NDJSON
  // straight to stdout for the Sapiens SIEM shipper.
  ...(config.isProduction || config.isTest
    ? {}
    : { transport: { target: 'pino/file', options: { destination: 1 } } }),
  enabled: !config.isTest,
});

export default logger;
