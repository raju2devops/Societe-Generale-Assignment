/**
 * Security regression suite.
 *
 * Each test pins a specific control from the sc Mandatory Secured
 * Development Controls or the OWASP Top 10:2025 / API Top 10 2023. If a future
 * refactor weakens one of them, a named test fails and says which control broke.
 */
import { jest } from '@jest/globals';
import { buildTestHarness, TEST_PASSWORD } from './helpers/testApp.js';
import { ROLES } from '../src/domain/constants.js';
import { correlationId } from '../src/middleware/correlationId.js';

jest.setTimeout(30_000);

const validAccount = {
  holderName: 'Jean Dupont',
  email: 'jean.dupont@example.com',
  accountType: 'SAVINGS',
  currency: 'EUR',
  branchCode: 'PAR001',
  initialDeposit: 0,
};

describe('A07:2025 - Authentication', () => {
  let harness;
  beforeEach(async () => {
    harness = await buildTestHarness();
  });

  test('an unknown e-mail and a wrong password return the identical error (no user enumeration)', async () => {
    await harness.container.authService.createUser({
      email: 'known@sg.test',
      displayName: 'Known',
      password: TEST_PASSWORD,
      role: ROLES.VIEWER,
    });

    const unknown = await harness
      .request()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@sg.test', password: 'Wrong-Password-123!' })
      .expect(401);

    const wrongPassword = await harness
      .request()
      .post('/api/v1/auth/login')
      .send({ email: 'known@sg.test', password: 'Wrong-Password-123!' })
      .expect(401);

    expect(unknown.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
    expect(unknown.body.error.message).toBe('Invalid credentials.');
  });

  test('the account locks after 3 failed attempts', async () => {
    await harness.container.authService.createUser({
      email: 'lockme@sg.test',
      displayName: 'Lock Me',
      password: TEST_PASSWORD,
      role: ROLES.VIEWER,
    });

    for (let i = 0; i < 3; i += 1) {
      await harness
        .request()
        .post('/api/v1/auth/login')
        .send({ email: 'lockme@sg.test', password: 'Definitely-Wrong-1!' })
        .expect(401);
    }

    // Even the CORRECT password is now refused, and with a distinct 423.
    const res = await harness
      .request()
      .post('/api/v1/auth/login')
      .send({ email: 'lockme@sg.test', password: TEST_PASSWORD })
      .expect(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  test('tokens are delivered as HttpOnly, SameSite=Strict cookies and never in the body', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    const cookies = admin.loginResponse.headers['set-cookie'].join(';');

    expect(cookies).toMatch(/sg_at=.*HttpOnly/i);
    expect(cookies).toMatch(/sg_rt=.*HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Strict/i);
    // The CSRF cookie must be readable by the SPA, so it is the one exception.
    expect(admin.loginResponse.headers['set-cookie'].find((c) => c.startsWith('sg_csrf'))).not.toMatch(/HttpOnly/i);

    const body = JSON.stringify(admin.loginResponse.body);
    expect(body).not.toContain('eyJ'); // no JWT anywhere in the response body
  });

  test('the login response reports the previous login and failures since', async () => {
    const first = await harness.signIn(ROLES.OFFICER, 'notice@sg.test');
    expect(first.loginResponse.body.data.notice).toHaveProperty('lastLoginAt');
    expect(first.loginResponse.body.data.notice).toHaveProperty('failedAttemptsSinceLastLogin', 0);
    expect(first.loginResponse.body.data.notice.passwordExpiresInDays).toBeLessThanOrEqual(90);
  });

  test('a forged access token with a different signature is rejected', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    const forged = admin.cookies.map((c) =>
      c.startsWith('sg_at') ? 'sg_at=eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9.; Path=/' : c
    );

    await harness.request().get('/api/v1/auth/me').set('Cookie', forged).expect(401);
  });

  test('logout revokes the whole session family', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    await admin.authed('post', '/api/v1/auth/logout').expect(204);

    const sessions = [...harness.repos.sessionRepository._store.values()];
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });
});

describe('A01:2025 / API5:2023 - Access control', () => {
  let harness;
  beforeEach(async () => {
    harness = await buildTestHarness();
  });

  test('an unauthenticated request to any account route is 401', async () => {
    await harness.request().get('/api/v1/accounts').expect(401);
    await harness.request().post('/api/v1/accounts').send(validAccount).expect(403); // CSRF first
  });

  test('a viewer can read but cannot create, update or delete', async () => {
    const viewer = await harness.signIn(ROLES.VIEWER);
    await viewer.authed('get', '/api/v1/accounts').expect(200);
    await viewer.authed('post', '/api/v1/accounts').send(validAccount).expect(403);
  });

  test('an officer can create and update but cannot delete', async () => {
    const officer = await harness.signIn(ROLES.OFFICER);
    const created = await officer.authed('post', '/api/v1/accounts').send(validAccount).expect(201);

    await officer
      .authed('put', `/api/v1/accounts/${created.body.data.id}`)
      .send({ holderName: 'Updated By Officer' })
      .expect(200);

    await officer
      .authed('delete', `/api/v1/accounts/${created.body.data.id}`)
      .send({ reason: 'Officer should not be able to do this' })
      .expect(403);
  });

  test('a denied request is written to the audit trail', async () => {
    const viewer = await harness.signIn(ROLES.VIEWER);
    await viewer.authed('post', '/api/v1/accounts').send(validAccount).expect(403);

    const denied = harness.repos.auditRepository._entries.find((e) => e.action === 'ACCESS_DENIED');
    expect(denied).toMatchObject({ outcome: 'FAILURE', actorRole: ROLES.VIEWER });
    expect(denied.metadata.permission).toBe('account:create');
  });

  test('a role downgrade takes effect immediately, without waiting for token expiry', async () => {
    const officer = await harness.signIn(ROLES.OFFICER);
    const user = [...harness.repos.userRepository._store.values()][0];

    await harness.repos.userRepository.updateById(user._id, { role: ROLES.VIEWER });

    // Same, still-valid token - but the role is re-read from the store.
    await officer.authed('post', '/api/v1/accounts').send(validAccount).expect(403);
  });

  test('a deactivated operator is locked out on the next request', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    const user = [...harness.repos.userRepository._store.values()][0];
    await harness.repos.userRepository.updateById(user._id, { isActive: false });

    await admin.authed('get', '/api/v1/accounts').expect(401);
  });
});

describe('CSRF (double-submit)', () => {
  let harness;
  beforeEach(async () => {
    harness = await buildTestHarness();
  });

  test('a state-changing request without the CSRF header is refused', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    const res = await harness
      .request()
      .post('/api/v1/accounts')
      .set('Cookie', admin.cookies) // cookies ride along as a browser would send them
      .send(validAccount)
      .expect(403);

    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  test('a mismatched CSRF header is refused', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    await harness
      .request()
      .post('/api/v1/accounts')
      .set('Cookie', admin.cookies)
      .set('x-csrf-token', 'not-the-right-token')
      .send(validAccount)
      .expect(403);
  });

  test('GET is exempt - safe methods do not need the header', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    await harness.request().get('/api/v1/accounts').set('Cookie', admin.cookies).expect(200);
  });
});

describe('A05:2025 / API3:2023 - Injection and mass assignment', () => {
  let harness;
  let admin;
  beforeEach(async () => {
    harness = await buildTestHarness();
    admin = await harness.signIn(ROLES.ADMIN);
  });

  test('a NoSQL operator payload is rejected by validation, never reaching the driver', async () => {
    const res = await admin
      .authed('post', '/api/v1/accounts')
      .send({ ...validAccount, email: { $ne: null } })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  test('an operator smuggled into a path parameter is rejected', async () => {
    await admin.authed('get', '/api/v1/accounts/%7B%22%24ne%22%3Anull%7D').expect(400);
  });

  test('an unknown property in the body is a 400, not a silent ignore', async () => {
    const res = await admin
      .authed('post', '/api/v1/accounts')
      .send({ ...validAccount, isAdmin: true })
      .expect(400);
    expect(res.body.error.details.some((d) => d.message.match(/unrecognized/i))).toBe(true);
  });

  test('status and balance cannot be mass-assigned through the update endpoint', async () => {
    const created = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);

    await admin
      .authed('put', `/api/v1/accounts/${created.body.data.id}`)
      .send({ holderName: 'Legit Change', status: 'FROZEN', balanceMinor: 99999999 })
      .expect(400);

    const after = await admin.authed('get', `/api/v1/accounts/${created.body.data.id}`).expect(200);
    expect(after.body.data.status).toBe('ACTIVE');
    expect(after.body.data.balance.amountMinor).toBe(0);
  });

  test('a script payload in a name is rejected by the allow-list, not merely escaped', async () => {
    await admin
      .authed('post', '/api/v1/accounts')
      .send({ ...validAccount, holderName: '<script>alert(1)</script>' })
      .expect(400);
  });

  test('the sort key cannot be attacker-controlled', async () => {
    await admin.authed('get', '/api/v1/accounts?sortBy=passwordHash').expect(400);
  });

  test('page size is capped', async () => {
    await admin.authed('get', '/api/v1/accounts?pageSize=100000').expect(400);
  });
});

describe('A10:2025 / A09:2025 - Errors, logging and headers', () => {
  let harness;
  beforeEach(async () => {
    harness = await buildTestHarness();
  });

  test('an error response never carries a stack trace or internal detail', async () => {
    const res = await harness.request().get('/api/v1/accounts/not-a-valid-id').expect(401);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'message']);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
  });

  test('malformed JSON produces a clean 400', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.c",,}')
      .expect(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  test('an oversized body is refused', async () => {
    await harness
      .request()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(64 * 1024) }))
      .expect(413);
  });

  test('security headers are present and the framework is not advertised', async () => {
    const res = await harness.request().get('/healthz').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('auth responses are marked no-store', async () => {
    const res = await harness
      .request()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@sg.test', password: 'Wrong-Password-1!' })
      .expect(401);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('every response carries a correlation id and a forged one is not echoed', async () => {
    // Deliberately NOT a CRLF payload: Node's http client rejects control
    // characters in a header value before the request is sent, so supertest
    // threw inside .set() and left its ephemeral server open - which both
    // failed this test and stopped jest from ever exiting. A space is a legal
    // header character and still fails the middleware's allow-list, so the
    // "forged value is not echoed" assertion is unchanged. The CRLF case is
    // covered directly against the middleware below.
    const res = await harness
      .request()
      .get('/healthz')
      .set('x-correlation-id', 'evil injected-log-line')
      .expect(200);
    expect(res.headers['x-correlation-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(res.headers['x-correlation-id']).not.toContain('injected');
  });

  test('a correlation id carrying CRLF is replaced rather than echoed into the logs', () => {
    const req = { get: () => 'evil\r\ninjected-log-line' };
    const headers = {};
    const res = {
      setHeader: (name, value) => {
        headers[name] = value;
      },
    };

    correlationId(req, res, () => {});

    expect(req.correlationId).not.toContain('injected');
    expect(req.correlationId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(headers['x-correlation-id']).toBe(req.correlationId);
  });

  test('an unknown route is a clean 404', async () => {
    const res = await harness.request().get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('CORS allow-list', () => {
  test('a non allow-listed origin is refused', async () => {
    const harness = await buildTestHarness();
    await harness
      .request()
      .get('/api/v1/accounts')
      .set('Origin', 'https://evil.example.com')
      .expect(403);
  });

  test('an allow-listed origin is permitted and credentials are enabled', async () => {
    const harness = await buildTestHarness();
    const res = await harness
      .request()
      .get('/healthz')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('Password policy and change flow', () => {
  let harness;
  beforeEach(async () => {
    harness = await buildTestHarness();
  });

  test('changing a password requires the current one', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    await admin
      .authed('post', '/api/v1/auth/change-password')
      .send({ currentPassword: 'Not-The-Password-1!', newPassword: 'Another-Valid-Pass-77!' })
      .expect(401);
  });

  test('a weak new password is rejected with per-field detail', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);
    const res = await admin
      .authed('post', '/api/v1/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
      .expect(400);
    expect(res.body.error.details.map((d) => d.field)).toContain('newPassword');
  });

  test('a password cannot be re-used, and every session dies on change', async () => {
    const admin = await harness.signIn(ROLES.ADMIN);

    await admin
      .authed('post', '/api/v1/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Brand-New-Passphrase-42!' })
      .expect(204);

    const sessions = [...harness.repos.sessionRepository._store.values()];
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    const relogin = await harness
      .request()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'Brand-New-Passphrase-42!' })
      .expect(200);

    // `[method]` stays on the same line as request(): a computed access opening
    // a line reads as an array literal to both the parser's ASI rules and to a
    // human, which is what no-unexpected-multiline is warning about.
    const client = (method, url) =>
      harness.request()[method](url)
        .set('Cookie', relogin.headers['set-cookie'])
        .set('x-csrf-token', relogin.body.data.csrfToken);

    const res = await client('post', '/api/v1/auth/change-password')
      .send({ currentPassword: 'Brand-New-Passphrase-42!', newPassword: TEST_PASSWORD })
      .expect(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });
});
