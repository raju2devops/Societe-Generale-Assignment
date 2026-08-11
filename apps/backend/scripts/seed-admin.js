#!/usr/bin/env node
/**
 * One-time bootstrap of the first administrator.
 *
 * There is NO default account and NO default password anywhere in this
 * codebase (Mandatory Control: "no default credentials", principle #2 secure
 * defaults). The credentials come from the environment for this single run and
 * should be removed from it immediately afterwards.
 *
 * The seeded admin is created with `mustChangePassword: true`, so the initial
 * password is one-time-use exactly as the back-office control requires.
 */
import { connectMongo, disconnectMongo } from '../src/db/mongo.js';
import { buildContainer } from '../src/container.js';
import { ROLES, INDEX_DOMAINS } from '../src/domain/constants.js';
import { passwordSchema } from '../src/validation/auth.schema.js';
import { blindIndex } from '../src/services/crypto.service.js';

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const displayName = process.env.SEED_ADMIN_NAME || 'Initial Administrator';

function fail(message) {
  process.stderr.write(`\n[seed] ${message}\n\n`);
  process.exit(1);
}

if (!email || !password) {
  fail('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set for this run.');
}

const policyCheck = passwordSchema.safeParse(password);
if (!policyCheck.success) {
  fail(
    'SEED_ADMIN_PASSWORD does not meet the password policy:\n  - ' +
      policyCheck.error.issues.map((i) => i.message).join('\n  - ')
  );
}

await connectMongo();
const { authService, userRepository } = buildContainer();

try {
  const existing = await userRepository.findByEmailIndex(
    blindIndex(email, INDEX_DOMAINS.USER_EMAIL)
  );
  if (existing) {
    process.stdout.write('[seed] An operator with that e-mail already exists. Nothing to do.\n');
  } else {
    const user = await authService.createUser({
      email,
      displayName,
      password,
      role: ROLES.ADMIN,
    });
    await userRepository.updateById(user._id, { mustChangePassword: true });
    process.stdout.write(
      '[seed] Administrator created. The password is one-time-use - change it at first login.\n' +
        '[seed] Now unset SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD from the environment.\n'
    );
  }
} catch (err) {
  fail(`Seed failed: ${err.message}`);
} finally {
  await disconnectMongo();
}
