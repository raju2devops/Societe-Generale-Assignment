/**
 * Environment configuration.
 *
 * sc Secure Development Principle #5 - "Fail securely".
 * Every value is validated at boot. If a secret is missing, weak, or malformed
 * the process aborts instead of silently falling back to an insecure default.
 *
 * Mandatory Controls: "Avoid hard-coding sensitive information", "Secrets
 * management", "Secure configuration management".
 */
import 'dotenv/config';
import { z } from 'zod';

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const csv = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Strict allow-list. `*` is rejected outright - CORS wildcard with
    // credentials is OWASP A02:2025 Security Misconfiguration.
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .refine((v) => !csv(v).includes('*'), {
        message: 'CORS_ORIGINS must be an explicit allow-list; "*" is forbidden.',
      }),

    /**
     * Number of reverse-proxy hops in front of this service.
     *
     * Express uses this to decide how far back into `X-Forwarded-For` to look
     * for the real client address, which is what every per-IP rate limit keys
     * on. Set it too high and a client can spoof the header and bypass the
     * login limiter; too low and every request appears to come from the proxy,
     * so one caller's failures throttle everybody.
     *
     * Count the hops that actually rewrite the header:
     *   local `npm run dev`              -> 0
     *   behind one nginx / load balancer -> 1
     *   AKS load balancer + web nginx    -> 2
     *
     * Defaults to 0, which is the safe direction to be wrong in.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    MONGODB_TLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    MONGODB_CA_FILE: z.string().optional().default(''),

    JWT_SECRET: z
      .string()
      .min(64, 'JWT_SECRET must be at least 64 characters (use `npm run genkeys`)'),
    FIELD_ENC_KEY: z
      .string()
      .regex(HEX_64, 'FIELD_ENC_KEY must be 64 hex characters (32 bytes) for AES-256-GCM'),
    BLIND_INDEX_KEY: z
      .string()
      .regex(HEX_64, 'BLIND_INDEX_KEY must be 64 hex characters (32 bytes) for HMAC-SHA256'),
    FIELD_ENC_KEY_ID: z.string().min(1).default('k1'),

    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(28800),
    REFRESH_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(300).max(86400).default(1800),
    JWT_ISSUER: z.string().min(1).default('sg-bank-accounts'),
    JWT_AUDIENCE: z.string().min(1).default('sg-bank-accounts-web'),

    AUTH_MODE: z.enum(['local', 'oidc']).default('local'),
    OIDC_ISSUER: z.string().optional().default(''),
    OIDC_AUDIENCE: z.string().optional().default(''),
    OIDC_JWKS_URI: z.string().optional().default(''),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.AUTH_MODE === 'oidc' && (!cfg.OIDC_ISSUER || !cfg.OIDC_JWKS_URI || !cfg.OIDC_AUDIENCE)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'AUTH_MODE=oidc requires OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI to be set.',
      });
    }
    if (cfg.NODE_ENV === 'production' && cfg.AUTH_MODE === 'local') {
      // SECURITY-DEVIATION (accepted for this assignment, see README "Security"):
      // sc policy default is SSO via Azure Entra ID (OIDC). The local
      // credential store is IdP-ready but is NOT approved for production.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'AUTH_MODE=local is not permitted when NODE_ENV=production. ' +
          'Configure the Azure Entra ID OIDC provider (AUTH_MODE=oidc).',
      });
    }
    // MONGODB_CA_FILE is intentionally NOT required alongside MONGODB_TLS.
    // A managed provider such as MongoDB Atlas presents a certificate from a
    // public CA, which Node's built-in trust store already validates - there is
    // no bundle to point at. Only a private CA needs one.
    if (cfg.NODE_ENV === 'production' && !cfg.MONGODB_TLS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MONGODB_TLS must be true in production (TLS 1.3 in transit).',
      });
    }
    if (cfg.REFRESH_IDLE_TIMEOUT_SECONDS > cfg.REFRESH_TOKEN_TTL_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REFRESH_IDLE_TIMEOUT_SECONDS cannot exceed REFRESH_TOKEN_TTL_SECONDS.',
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Deliberately printed to stderr and NOT through the logger: the logger is not
  // constructed yet. Only the field names and rules are printed - never values.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'config'}: ${i.message}`);
  process.stderr.write(
    `\n[FATAL] Invalid application configuration. Startup aborted.\n${issues.join('\n')}\n\n` +
      'Copy .env.example to .env and run `npm run genkeys` to mint the crypto keys.\n\n'
  );
  process.exit(1);
}

const raw = parsed.data;

export const config = Object.freeze({
  env: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  trustProxyHops: raw.TRUST_PROXY_HOPS,
  corsOrigins: Object.freeze(csv(raw.CORS_ORIGINS)),
  mongo: Object.freeze({
    uri: raw.MONGODB_URI,
    tls: raw.MONGODB_TLS,
    caFile: raw.MONGODB_CA_FILE || undefined,
  }),
  crypto: Object.freeze({
    jwtSecret: raw.JWT_SECRET,
    fieldEncKey: Buffer.from(raw.FIELD_ENC_KEY, 'hex'),
    blindIndexKey: Buffer.from(raw.BLIND_INDEX_KEY, 'hex'),
    fieldEncKeyId: raw.FIELD_ENC_KEY_ID,
  }),
  tokens: Object.freeze({
    accessTtl: raw.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtl: raw.REFRESH_TOKEN_TTL_SECONDS,
    refreshIdleTimeout: raw.REFRESH_IDLE_TIMEOUT_SECONDS,
    issuer: raw.JWT_ISSUER,
    audience: raw.JWT_AUDIENCE,
  }),
  auth: Object.freeze({
    mode: raw.AUTH_MODE,
    oidc: Object.freeze({
      issuer: raw.OIDC_ISSUER,
      audience: raw.OIDC_AUDIENCE,
      jwksUri: raw.OIDC_JWKS_URI,
    }),
    maxFailedAttempts: 3, // Mandatory Control: lock account after 3 failed attempts
    lockoutMinutes: 30,
    passwordHistorySize: 10, // Mandatory Control: remember last 10 passwords
  }),
});

export default config;
