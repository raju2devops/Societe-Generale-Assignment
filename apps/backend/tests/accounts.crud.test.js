/**
 * CRUD happy paths + the business rules that guard them.
 */
import { jest } from '@jest/globals';
import { buildTestHarness } from './helpers/testApp.js';
import { ROLES } from '../src/domain/constants.js';

jest.setTimeout(30_000);

const validAccount = {
  holderName: 'Amelie Laurent',
  email: 'amelie.laurent@example.com',
  phone: '+33 1 42 13 20 00',
  address: '29 Boulevard Haussmann, 75009 Paris',
  accountType: 'CURRENT',
  currency: 'EUR',
  branchCode: 'PAR001',
  initialDeposit: 1500.5,
};

describe('Accounts CRUD', () => {
  let harness;
  let admin;

  beforeEach(async () => {
    harness = await buildTestHarness();
    admin = await harness.signIn(ROLES.ADMIN);
  });

  test('CREATE returns 201, allocates an account number and echoes a Location header', async () => {
    const res = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);

    expect(res.headers.location).toMatch(/^\/api\/v1\/accounts\/[a-f\d]{24}$/);
    expect(res.body.data).toMatchObject({
      holderName: 'Amelie Laurent',
      email: 'amelie.laurent@example.com',
      accountType: 'CURRENT',
      status: 'ACTIVE',
      branchCode: 'PAR001',
    });
    expect(res.body.data.accountNumber).toMatch(/^FR\d{2}[A-Z0-9]{10,30}$/);
    // Money round-trips through minor units without float drift.
    expect(res.body.data.balance).toEqual({ amountMinor: 150050, amount: 1500.5, currency: 'EUR' });
  });

  test('CREATE persists PII as ciphertext only - no plaintext reaches the store', async () => {
    const res = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    const stored = [...harness.repos.accountRepository._store.values()][0];
    const raw = JSON.stringify(stored);

    expect(raw).not.toContain('Amelie Laurent');
    expect(raw).not.toContain('amelie.laurent@example.com');
    expect(raw).not.toContain('Boulevard Haussmann');
    expect(raw).not.toContain(res.body.data.accountNumber);
    expect(stored.holderNameEnc).toMatch(/^v1\.k1\./);
  });

  test('READ by id returns the full detail projection', async () => {
    const created = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    const res = await admin.authed('get', `/api/v1/accounts/${created.body.data.id}`).expect(200);
    expect(res.body.data.id).toBe(created.body.data.id);
    expect(res.body.data.accountNumberMasked).toMatch(/^FR\d{2} \*{4} \*{4} .{4}$/);
  });

  test('READ by account number resolves through the blind index', async () => {
    const created = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    const number = created.body.data.accountNumber;

    const res = await admin.authed('get', `/api/v1/accounts/by-number/${number}`).expect(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  test('READ by an unknown account number is a 404, not a 500', async () => {
    await admin.authed('get', '/api/v1/accounts/by-number/FR7699999999999999').expect(404);
  });

  test('LIST paginates, caps page size and masks identifiers', async () => {
    for (let i = 0; i < 3; i += 1) {
      await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    }
    const res = await admin.authed('get', '/api/v1/accounts?page=1&pageSize=2').expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(res.body.data[0]).not.toHaveProperty('accountNumber');
    expect(res.body.data[0].emailMasked).toMatch(/^a\*+@example\.com$/);
  });

  test('UPDATE changes only the supplied fields', async () => {
    const created = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    const res = await admin
      .authed('put', `/api/v1/accounts/${created.body.data.id}`)
      .send({ holderName: 'Amelie Laurent-Dubois', branchCode: 'LYO002' })
      .expect(200);

    expect(res.body.data.holderName).toBe('Amelie Laurent-Dubois');
    expect(res.body.data.branchCode).toBe('LYO002');
    expect(res.body.data.email).toBe('amelie.laurent@example.com'); // untouched
    expect(res.body.data.version).toBe(created.body.data.version + 1);
  });

  test('UPDATE with a stale version is a 409, not a silent overwrite', async () => {
    const created = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    const id = created.body.data.id;

    await admin.authed('put', `/api/v1/accounts/${id}`).send({ holderName: 'First Writer' }).expect(200);

    await admin
      .authed('put', `/api/v1/accounts/${id}`)
      .send({ holderName: 'Stale Writer', expectedVersion: created.body.data.version })
      .expect(409);
  });

  test('DELETE soft-closes a zero-balance account and keeps the record', async () => {
    const created = await admin
      .authed('post', '/api/v1/accounts')
      .send({ ...validAccount, initialDeposit: 0 })
      .expect(201);
    const id = created.body.data.id;

    const res = await admin
      .authed('delete', `/api/v1/accounts/${id}`)
      .send({ reason: 'Customer request - branch closure' })
      .expect(200);

    expect(res.body.data).toMatchObject({ status: 'CLOSED', isDeleted: true });
    expect(harness.repos.accountRepository._store.has(id)).toBe(true);
    await admin.authed('get', `/api/v1/accounts/${id}`).expect(404);
  });

  test('DELETE is refused while the account still holds funds', async () => {
    const created = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    const res = await admin
      .authed('delete', `/api/v1/accounts/${created.body.data.id}`)
      .send({ reason: 'Attempting to close a funded account' })
      .expect(422);

    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  test('PURGE only applies to an already-closed account', async () => {
    const created = await admin
      .authed('post', '/api/v1/accounts')
      .send({ ...validAccount, initialDeposit: 0 })
      .expect(201);
    const id = created.body.data.id;

    await admin.authed('delete', `/api/v1/accounts/${id}/purge`).expect(422);

    await admin.authed('delete', `/api/v1/accounts/${id}`).send({ reason: 'Closing first' }).expect(200);
    await admin.authed('delete', `/api/v1/accounts/${id}/purge`).expect(204);

    expect(harness.repos.accountRepository._store.has(id)).toBe(false);
  });

  test('every mutation leaves an audit entry that contains no PII', async () => {
    const created = await admin.authed('post', '/api/v1/accounts').send(validAccount).expect(201);
    await admin
      .authed('put', `/api/v1/accounts/${created.body.data.id}`)
      .send({ holderName: 'Renamed Person' })
      .expect(200);

    const entries = harness.repos.auditRepository._entries;
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['LOGIN_SUCCEEDED', 'ACCOUNT_CREATED', 'ACCOUNT_UPDATED'])
    );

    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('Amelie');
    expect(serialised).not.toContain('Renamed Person');
    expect(serialised).not.toContain('example.com');
    // Field names are recorded; values are not.
    const update = entries.find((e) => e.action === 'ACCOUNT_UPDATED');
    expect(update.metadata.changedFields).toEqual(['holderName']);
  });
});
