import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as jose from 'jose';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '../../src/db/connection.js';
import { findOrCreateUser } from '../../src/modules/user/user-service.js';
import { validateAccessToken, extractBearerToken, initJwks } from '../../src/modules/auth/token-validator.js';
import { createTestToken, createTokenWithWrongKey, createExpiredToken, getTestJwk } from '../helpers.js';

const options = { issuer: 'http://localhost:8180/realms/iam-platform', audience: 'iam-backend' };

describe('T03/T04/T09: production access token validation with real JOSE signatures', () => {
  beforeAll(async () => {
    vi.stubEnv('KEYCLOAK_INTROSPECTION', 'false');
    vi.stubEnv('KEYCLOAK_ALLOWED_AZP', '');
    initJwks(options.issuer, jose.createLocalJWKSet({ keys: [await getTestJwk()] }));
  });
  afterAll(() => vi.unstubAllEnvs());

  it('extracts only the exact Bearer scheme', () => {
    expect(extractBearerToken('Bearer token')).toBe('token');
    expect(() => extractBearerToken(undefined)).toThrow('Missing Authorization');
    expect(() => extractBearerToken('Basic token')).toThrow('Bearer scheme');
    expect(() => extractBearerToken('bearer token')).toThrow('Bearer scheme');
    expect(() => extractBearerToken('Bearer ')).toThrow('Empty Bearer');
  });
  it('accepts a valid access token', async () => {
    const claims = await validateAccessToken(await createTestToken(), options);
    expect(claims.sub).toBeTypeOf('string');
    expect(claims.iss).toBe(options.issuer);
  });
  it('rejects an invalid signature with the same trusted kid', async () => {
    await expect(validateAccessToken(await createTokenWithWrongKey(), options)).rejects.toThrow('signature');
  });
  it('rejects expiration', async () => {
    await expect(validateAccessToken(await createExpiredToken(), options)).rejects.toThrow('expired');
    await expect(validateAccessToken(await createTestToken({ exp: Math.floor(Date.now() / 1000) - 1 }), options)).rejects.toThrow('expired');
  });
  it.each(['exp', 'sub', 'iss', 'aud', 'typ'])('requires %s', async claim => {
    await expect(validateAccessToken(await createTestToken({ omit: [claim] }), options)).rejects.toThrow();
  });
  it.each([
    { iss: 'https://attacker.invalid/realms/iam-platform' }, { aud: 'iam-web' },
    { typ: 'ID' }, { typ: 'bearer' }, { sub: '' },
  ])('rejects mismatched claims %j', async claims => {
    await expect(validateAccessToken(await createTestToken(claims), options)).rejects.toThrow();
  });
  it.each([
    { exp: '9999999999' }, { sub: 123 }, { iss: 123 }, { aud: [123] }, { aud: ['iam-backend', 123] }, { typ: true },
    { iat: '123' }, { iat: Math.floor(Date.now() / 1000) + 60 },
    { email: [] }, { email_verified: 'true' }, { preferred_username: {} },
    { azp: [] }, { scope: [] }, { sid: [] }, { session_state: 123 },
    { sid: 'one', session_state: 'two' }, { identity_provider: [] }, { idp: {} },
    { identity_provider_identity: {} }, { broker_session_id: [] }, { broker_user_id: 123 },
    { realm_access: { roles: 'admin' } }, { resource_access: { client: { roles: [123] } } },
  ])('rejects malformed claims %j', async claims => {
    await expect(validateAccessToken(await createTestToken({ claims }), options)).rejects.toThrow();
  });
  it('enforces the optional authorized-party allowlist', async () => {
    await expect(validateAccessToken(await createTestToken({ azp: 'untrusted' }), { ...options, authorizedParties: ['iam-web'] })).rejects.toThrow('authorized party');
    await expect(validateAccessToken(await createTestToken({ azp: 'iam-web' }), { ...options, authorizedParties: ['iam-web'] })).resolves.toBeDefined();
    await expect(validateAccessToken(await createTestToken({ omit: ['azp'] }), { ...options, authorizedParties: ['iam-web'] })).rejects.toThrow();
  });
  it('rejects a signed non-RS256 algorithm', async () => {
    const key = await jose.generateKeyPair('ES256');
    const token = await new jose.SignJWT(jose.decodeJwt(await createTestToken()))
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' }).sign(key.privateKey);
    await expect(validateAccessToken(token, options)).rejects.toThrow();
  });
});

describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')('Concurrent issuer-subject identity provisioning', () => {
  const testIssuer = `https://identity-test.invalid/${randomUUID()}`;
  afterAll(async () => {
    const db = getDb();
    const identities = await db.selectFrom('authentication_identities').select('user_id').where('issuer', '=', testIssuer).execute();
    await db.deleteFrom('authentication_identities').where('issuer', '=', testIssuer).execute();
    if (identities.length) await db.deleteFrom('users').where('id', 'in', identities.map(identity => identity.user_id)).execute();
    await closeDb();
  });
  it('creates exactly one user for simultaneous first-login calls', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => findOrCreateUser(testIssuer, 'concurrent', 'shared@example.invalid', 'Concurrent', true)));
    expect(new Set(results.map(result => result.userId)).size).toBe(1);
    expect(results.filter(result => result.created)).toHaveLength(1);
  });
  it('never merges identities by shared email and persists actual email verification', async () => {
    const one = await findOrCreateUser(testIssuer, 'one', 'shared@example.invalid', 'One');
    const two = await findOrCreateUser(testIssuer, 'two', 'shared@example.invalid', 'Two', true);
    expect(one.userId).not.toBe(two.userId);
    const identities = await getDb().selectFrom('authentication_identities').select(['subject', 'email_verified'])
      .where('issuer', '=', testIssuer).where('subject', 'in', ['one', 'two']).execute();
    expect(identities.find(identity => identity.subject === 'one')?.email_verified).toBe(false);
    expect(identities.find(identity => identity.subject === 'two')?.email_verified).toBe(true);
  });
});
