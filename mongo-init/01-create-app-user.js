/**
 * Runs once, on first boot of an empty MongoDB volume.
 *
 * Creates the least-privilege user the application authenticates as. The root
 * credential set in docker-compose exists only to bootstrap this user and is
 * never used by the running service.
 *
 * sc Mandatory Controls: "Apply least privilege", "Restrict web-server
 * privileges - never connect to the DB as DBADMIN", "Secure database
 * configuration".
 *
 * The audit collection is granted insert and read only - no update, no remove -
 * so a compromised application cannot rewrite or erase its own trail
 * (Mandatory Control: "Logs are classified CRITICAL").
 */

/* global db, process, print */

const appPassword = process.env.APP_PASSWORD;

if (!appPassword || appPassword.length < 12) {
  throw new Error('APP_PASSWORD must be provided to the mongo container and be at least 12 characters.');
}

const appDb = db.getSiblingDB('sgbank');

appDb.createRole({
  role: 'sgbankAppRole',
  privileges: [
    {
      resource: { db: 'sgbank', collection: 'accounts' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex', 'listIndexes'],
    },
    {
      resource: { db: 'sgbank', collection: 'users' },
      actions: ['find', 'insert', 'update', 'createIndex', 'listIndexes'],
    },
    {
      resource: { db: 'sgbank', collection: 'sessions' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex', 'listIndexes'],
    },
    {
      resource: { db: 'sgbank', collection: 'auditlogs' },
      actions: ['find', 'insert', 'createIndex', 'listIndexes'],
    },
  ],
  roles: [],
});

appDb.createUser({
  user: 'sgbank_app',
  pwd: appPassword,
  roles: [{ role: 'sgbankAppRole', db: 'sgbank' }],
});

print('[init] Created role sgbankAppRole and user sgbank_app on database sgbank.');
