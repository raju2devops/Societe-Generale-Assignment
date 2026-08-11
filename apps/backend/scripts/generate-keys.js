#!/usr/bin/env node
/**
 * Mint the three cryptographic keys the service requires.
 *
 * Output goes to STDOUT only. Nothing is written to disk, so a stray key file
 * cannot be left behind or committed. Pipe it straight into your secret store:
 *
 *   node scripts/generate-keys.js
 *   az keyvault secret set --vault-name sg-bank-kv --name jwt-secret --value "<...>"
 */
import crypto from 'node:crypto';

const values = {
  JWT_SECRET: crypto.randomBytes(48).toString('hex'), // 96 hex chars
  FIELD_ENC_KEY: crypto.randomBytes(32).toString('hex'), // AES-256
  BLIND_INDEX_KEY: crypto.randomBytes(32).toString('hex'), // HMAC-SHA256
};

process.stdout.write(
  '\n# Generated ' +
    new Date().toISOString() +
    '\n# Store these in Azure Key Vault. Do NOT commit them.\n' +
    '# Rotating FIELD_ENC_KEY requires bumping FIELD_ENC_KEY_ID and keeping the\n' +
    '# old key on the key ring so existing ciphertext stays readable.\n\n' +
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n\n'
);
