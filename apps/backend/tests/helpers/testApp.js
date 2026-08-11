/**
 * Builds a fully-wired Express app over in-memory repositories, plus a small
 * authenticated-client helper that carries the auth cookies and the CSRF header
 * the same way the browser does.
 */
import request from 'supertest';
import { buildContainer } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { ROLES } from '../../src/domain/constants.js';
import {
  createInMemoryAccountRepository,
  createInMemoryUserRepository,
  createInMemorySessionRepository,
  createInMemoryAuditRepository,
} from './inMemoryRepositories.js';

export const TEST_PASSWORD = 'Correct-Horse-Battery-9!';

export async function buildTestHarness() {
  const repos = {
    accountRepository: createInMemoryAccountRepository(),
    userRepository: createInMemoryUserRepository(),
    sessionRepository: createInMemorySessionRepository(),
    auditRepository: createInMemoryAuditRepository(),
  };

  const container = buildContainer(repos);
  container.isReady = () => true;
  const app = createApp(container);

  /** Create an operator with the given role and return a logged-in client. */
  async function signIn(role = ROLES.ADMIN, email = `${role}@sg.test`) {
    await container.authService.createUser({
      email,
      displayName: `${role} user`,
      password: TEST_PASSWORD,
      role,
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);

    const cookies = res.headers['set-cookie'];
    const csrfToken = res.body.data.csrfToken;

    /** Mirrors what the SPA does: send cookies + echo the CSRF token. */
    const authed = (method, url) =>
      request(app)[method](url).set('Cookie', cookies).set('x-csrf-token', csrfToken);

    return { cookies, csrfToken, authed, loginResponse: res, email };
  }

  return { app, container, repos, signIn, request: () => request(app) };
}

export default buildTestHarness;
