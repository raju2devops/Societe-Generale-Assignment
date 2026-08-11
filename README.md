# Societe Generale — Bank Account Management

A full-stack CRUD application for bank accounts: **React SPA** front end, **Node.js / Express** REST API, **MongoDB** persistence.

> **Trademark notice.** "Societe Generale" and its logo are registered trademarks of Societe Generale S.A. This is an unaffiliated demonstration application. The mark in `apps/frontend/src/components/BrandMark.jsx` is an **original** graphic drawn for this project, not the official logo. To swap in the official asset, drop it at `apps/frontend/public/brand/logo.svg` and set `VITE_BRAND_LOGO_URL=/brand/logo.svg` — no other change is needed.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [API reference](#api-reference)
- [Testing](#testing)
- [Security design](#security-design)
- [Configuration](#configuration)
- [Known limitations](#known-limitations)

---

## What it does

| Capability | Endpoint | Who |
|---|---|---|
| **Create** an account (system-generated French IBAN) | `POST /api/v1/accounts` | officer, admin |
| **Read** an account by internal id | `GET /api/v1/accounts/:id` | viewer, officer, admin |
| **Read** an account **by account number** | `GET /api/v1/accounts/by-number/:accountNumber` | viewer, officer, admin |
| **List** accounts (paged, filtered, sorted) | `GET /api/v1/accounts` | viewer, officer, admin |
| **Update** account details | `PUT /api/v1/accounts/:id` | officer, admin |
| **Change** operational status | `PATCH /api/v1/accounts/:id/status` | officer, admin |
| **Delete** (safe soft-close) | `DELETE /api/v1/accounts/:id` | admin |
| **Purge** (GDPR Art.17 erasure) | `DELETE /api/v1/accounts/:id/purge` | admin |

"Delete" is a **soft close**, not an erasure: the account is marked `CLOSED`, removed from the working set, and retained for audit. A funded account cannot be closed. Irreversible erasure is a separate, admin-only endpoint that only accepts an already-closed account.

---

## Quick start

Prerequisites: Node.js ≥ 20.11, and Docker (or a local MongoDB).

### 1. Install and mint the cryptographic keys

```bash
cd backend  && npm install      # also generates package-lock.json
cd ../frontend && npm install   # ditto
cd ../backend  && npm run genkeys
```

`genkeys` prints `JWT_SECRET`, `FIELD_ENC_KEY` and `BLIND_INDEX_KEY` to stdout. Nothing is written to disk.

> **Commit both `package-lock.json` files.** The Dockerfiles use `npm ci`, which requires a lock file and installs exactly what is pinned — a floating version can never reach an image.

### 2a. Run everything with Docker

```bash
# from the repository root
export MONGO_ROOT_PASSWORD='...' MONGO_APP_PASSWORD='...'
export JWT_SECRET='...' FIELD_ENC_KEY='...' BLIND_INDEX_KEY='...'

docker compose up --build
```

Compose **refuses to start** if any of those are unset — deliberate, not a bug. The app is at <http://localhost:8080>.

On first boot, `mongo-init/01-create-app-user.js` creates `sgbank_app`, a least-privilege user with `readWrite` on the application database only (and insert-only on the audit collection). The root credential is used once, to bootstrap that user, and never by the running service.

### 2b. Or run the two services directly

```bash
# terminal 1 — API
cd backend
cp .env.example .env      # fill in MONGODB_URI + the three keys
npm run dev               # http://localhost:4000

# terminal 2 — SPA
cd frontend
npm run dev               # http://localhost:5173, proxies /api to :4000
```

### 3. Create the first operator

There is no default account and no default password anywhere in this codebase.

```bash
cd backend
SEED_ADMIN_EMAIL='you@sapiens.com' \
SEED_ADMIN_PASSWORD='<a passphrase meeting the policy>' \
npm run seed
```

The seeded administrator is created with `mustChangePassword: true`, so the initial password is one-time-use. Unset both variables afterwards.

---

## Architecture

Strictly layered, and every layer depends only on the one below it through a plain-object port:

```
 HTTP  ─►  routes ─► middleware ─► controllers ─►  services  ─► repositories ─► MongoDB
           │          authn         HTTP only       business      storage port
           │          authz                         rules
           │          CSRF                          crypto
           │          validation                    audit
           │          rate limit
           └────────────────────────────► errors / DTOs ───────────────► JSON
```

Concretely:

- **`src/controllers`** translate HTTP and nothing else. No business rules, no database, no crypto.
- **`src/services`** hold every rule. They import **no** Express and **no** Mongoose — only the ports they were handed.
- **`src/repositories`** are the only place that knows about Mongoose. Each exports a factory returning a plain object.
- **`src/container.js`** is the single composition root — the only file that decides which implementation backs each port.

That decoupling is not decorative. The whole test suite runs the real HTTP stack, real middleware, real services and real crypto against **in-memory repositories**, with no database at all (`tests/helpers/inMemoryRepositories.js`). Swapping MongoDB for PostgreSQL means writing one new adapter and changing one line in `container.js`.

```
apps/
  backend/
    src/
      config/       env (fail-fast, zod-validated) · structured logger
      domain/       roles, permissions, enums — framework-free
      validation/   zod schemas (allow-list, .strict())
      middleware/   correlationId · authenticate · authorize · csrf · validate
                    · cookies · rateLimiters · errorHandler · asyncHandler
      controllers/  HTTP translation
      services/     account · auth · token · crypto
      repositories/ mongo adapters (account · user · session · audit)
      models/       mongoose schemas
      dto/          response view models
      errors/       error taxonomy (safe message + internal detail)
    tests/          crypto unit tests · CRUD tests · security regression suite
    scripts/        generate-keys · seed-admin
  frontend/
    src/
      api/          fetch wrapper (cookies + CSRF, no token in JS)
      context/      session state
      components/   BrandMark · UI primitives
      pages/        Login · Accounts · AccountDetail · AccountForm
mongo-init/       least-privilege database user, created on first boot
helm-chart/       generic chart both tiers deploy through
k8s/              per-tier values files
terraform/        AKS · Key Vault · workload identity · cluster add-ons
```

---

## API reference

Base path `/api/v1`. All responses are JSON. Errors always take the shape:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "correlationId": "…", "details": [ … ] } }
```

`details` is present on `400` only, and lists field names — never values.

### Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Sets three cookies; returns the profile, a CSRF token and the last-login notice |
| `POST` | `/auth/refresh` | Rotating refresh; reuse of a rotated token revokes the whole session family |
| `POST` | `/auth/logout` | Revokes the session family and clears cookies |
| `GET` | `/auth/me` | Current principal |
| `POST` | `/auth/change-password` | Requires the current password; revokes every session on success |

**Cookies.** `sg_at` (access, HttpOnly), `sg_rt` (refresh, HttpOnly), `sg_csrf` (readable). In production all three carry the `__Host-` prefix.

**CSRF.** Echo the `sg_csrf` cookie value in an `x-csrf-token` header on every state-changing request — with two deliberate exceptions. `POST /auth/login` and `POST /auth/refresh` are the endpoints that *issue* that cookie, so they cannot require it; demanding a token the caller has not been given yet would make login impossible. Those two are covered instead by `SameSite=Strict` on the auth cookies (a cross-site request cannot carry a session at all), the strict CORS allow-list, and the auth rate limiter. Everything that acts on an existing session — `/auth/logout`, `/auth/change-password` and the whole `/accounts` subtree — keeps the full double-submit check.

### Trying it with curl

```bash
API=http://localhost:4000/api/v1

# 1. sign in — keeps the cookies in a jar and captures the CSRF token
CSRF=$(curl -s -c jar.txt -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@sapiens.com","password":"<your password>"}' \
  | python -c 'import json,sys; print(json.load(sys.stdin)["data"]["csrfToken"])')

# 2. create an account
curl -s -b jar.txt -X POST "$API/accounts" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d '{
        "holderName": "Amelie Laurent",
        "email": "amelie.laurent@example.com",
        "phone": "+33 1 42 13 20 00",
        "address": "29 Boulevard Haussmann, 75009 Paris",
        "accountType": "CURRENT",
        "currency": "EUR",
        "branchCode": "PAR001",
        "initialDeposit": 1500.50
      }'

# 3. read it back by account number
curl -s -b jar.txt "$API/accounts/by-number/FR76..."

# 4. list, filtered and paged
curl -s -b jar.txt "$API/accounts?status=ACTIVE&page=1&pageSize=10"

# 5. update
curl -s -b jar.txt -X PUT "$API/accounts/<id>" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d '{"holderName":"Amelie Laurent-Dubois","expectedVersion":0}'

# 6. close (soft delete)
curl -s -b jar.txt -X DELETE "$API/accounts/<id>" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d '{"reason":"Customer request"}'
```

A successful create returns:

```json
{
  "data": {
    "id": "6712f0c2a91b4e0f0c8d1234",
    "accountNumber": "FR7630003008730123456789012",
    "accountNumberMasked": "FR76 **** **** 9012",
    "holderName": "Amelie Laurent",
    "accountType": "CURRENT",
    "status": "ACTIVE",
    "balance": { "amountMinor": 150050, "amount": 1500.5, "currency": "EUR" },
    "version": 0
  }
}
```

Account numbers are generated with the CSPRNG and carry both a valid **French RIB key** and valid **ISO 13616 mod-97** check digits, so they pass any downstream IBAN validator.

### Concurrency

`PUT`, `PATCH` and `DELETE` accept an optional `expectedVersion`. If it does not match, the request fails with `409 CONFLICT` instead of silently overwriting someone else's change.

---

## Testing

```bash
cd backend
npm test              # unit + integration + security regression suite
npm run test:coverage
npm run lint
```

Three suites, none of which need a database:

- **`crypto.test.js`** — AES-256-GCM round trip, tamper detection, AAD key binding, blind-index determinism and namespacing, scrypt verification, IBAN check-digit validity.
- **`accounts.crud.test.js`** — every CRUD path, plus proof that no plaintext PII reaches the store and that the audit trail contains no PII.
- **`security.test.js`** — one test per control: user enumeration, lockout after 3 attempts, cookie flags, forged tokens, role downgrade taking effect immediately, CSRF, NoSQL injection, mass assignment, sort-key injection, error-shape leakage, security headers, CORS allow-list, password history.

---

## Security design

### Data protection

Every identifying field — account number, holder name, e-mail, phone, address — is encrypted **in the application** with **AES-256-GCM** before it reaches MongoDB. The stored envelope is `v1.<keyId>.<iv>.<tag>.<ciphertext>`; the key id is bound into the GCM additional authenticated data, so envelopes cannot be swapped between key generations and the key can be rotated without a schema change.

Fields that must stay searchable (account number, e-mail) additionally carry a **blind index**: `HMAC-SHA256(normalisedValue, BLIND_INDEX_KEY)`. It is deterministic enough to carry a unique constraint, but keyed — so a database dump alone cannot be brute-forced, because the key never lives in the database.

Balances are stored as integer **minor units**. No floating point touches money.

### Authentication and sessions

Access tokens are HS256 JWTs delivered in an **HttpOnly** cookie — JavaScript never sees a token, so an XSS payload has nothing to steal. There is no `localStorage` or `sessionStorage` anywhere in the front end, and ESLint blocks it. The algorithm is pinned on verify (`algorithms: ['HS256']`), which is what makes `alg: none` and RS256 key-confusion structurally impossible.

Refresh tokens are opaque 256-bit CSPRNG strings stored only as a SHA-256 fingerprint, rotated on every use, with reuse detection that burns the whole session family. Idle timeout is 30 minutes; the absolute timeout survives rotation.

Passwords use Node's built-in **scrypt** (N=2¹⁵, r=8, p=2, 64-byte key, unique 16-byte salt) — permitted by the Sapiens controls and, being standard library, adding zero supply-chain surface. Three failed attempts locks the account. Login failures return one identical message regardless of cause.

### Authorisation

Roles → permissions → routes. Every route declares its required permission explicitly; the service layer checks it **again**, so a future caller that bypasses the HTTP middleware still cannot bypass authorisation. The role is re-read from the database on every request, so a downgrade or deactivation takes effect immediately rather than at token expiry.

### Input handling

Allow-list validation with zod on body, query and params. Every object schema is `.strict()`, so an unexpected property is a `400` rather than a silently-ignored field — that is what closes mass assignment. Sort keys and page sizes come from closed enums. There is no `Object.assign(entity, req.body)` anywhere in the codebase; every field is mapped explicitly.

### Errors, logging and audit

Responses carry only `code`, a safe message and the correlation id. Stack traces, driver messages and query text go to the log and nowhere else. Logs are structured NDJSON with redaction applied at the serialiser, so a careless `logger.info({ req })` still cannot leak a cookie or a PII field. Every create, read, update, close, purge, login, lockout and access denial is written to an append-only audit collection that stores **field names, never values**.

### Containers

Both images run as a non-root user with a read-only root filesystem and all Linux capabilities dropped. nginx serves the SPA on 8080 and reverse-proxies `/api` to the backend, so the browser sees a single origin and the auth cookies stay same-site. The database sits on an internal Docker network the web tier cannot reach.

---

## Configuration

See `apps/backend/.env.example` for the full annotated list. Startup **aborts** if any required value is missing or too weak — there is no insecure fallback. Notably:

- `AUTH_MODE=local` is **rejected** when `NODE_ENV=production`; production must use `AUTH_MODE=oidc` against Azure Entra ID.
- `MONGODB_TLS` must be `true` in production.
- `CORS_ORIGINS` rejects `*` outright.

--- 

## Owner

Raju Vishwakarma 
