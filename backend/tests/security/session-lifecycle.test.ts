import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { initJwks, validateAccessToken } from '../../src/modules/auth/token-validator.js';
import { introspectAccessToken, listProviderSessions, revokeProviderSession, resetProviderSessions } from '../../src/modules/auth/session-service.js';
import { createTestToken, getTestJwk } from '../helpers.js';
import { getDb, closeDb } from '../../src/db/connection.js';

const issuer = process.env.JWT_ISSUER || 'http://localhost:8180/realms/iam-platform';
const options = { issuer, audience: 'iam-backend' };

describe('Uncached fail-closed provider session authentication', () => {
  beforeAll(async () => initJwks(options.issuer, jose.createLocalJWKSet({ keys: [await getTestJwk()] })));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  function configure() {
    vi.stubEnv('KEYCLOAK_INTROSPECTION', 'true');
    vi.stubEnv('KEYCLOAK_CLIENT_SECRET', 'test-only-secret');
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_SECRET', 'test-only-admin-secret');
    vi.stubEnv('KEYCLOAK_ALLOWED_AZP', '');
  }
  it('checks every request and immediately rejects a previously active token', async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ active: true, sub: 'subject', sid: 'session' }))
      .mockResolvedValueOnce(Response.json({ active: false }));
    vi.stubGlobal('fetch', fetcher);
    const token = await createTestToken({ claims: { sub: 'subject', sid: 'session' } });
    await expect(validateAccessToken(token, options)).resolves.toBeDefined();
    await expect(validateAccessToken(token, options)).rejects.toThrow('inactive');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { active: 'true', sub: 'subject', sid: 'session' },
    { active: true, sub: 'other', sid: 'session' },
    { active: true, sub: 'subject', sid: 'other' },
    { active: true, sub: 'subject' },
    { active: true, sub: 'subject', sid: [] },
    { active: true, sub: 'subject', sid: 'session', session_state: 'other' },
  ])('rejects malformed or mismatched introspection %j', async claims => {
    configure(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(claims)));
    await expect(introspectAccessToken('token', { sub: 'subject', iss: issuer, sid: 'session' })).rejects.toThrow();
  });
  it('accepts session_state provider references', async () => {
    configure(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ active: true, sub: 'subject', session_state: 'session' })));
    await expect(introspectAccessToken('token', { sub: 'subject', iss: issuer, session_state: 'session' })).resolves.toBeUndefined();
  });
  it('fails closed on network, HTTP, JSON, or credentials failure', async () => {
    configure();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('not-json'));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 3; i++) await expect(introspectAccessToken('token', { sub: 'subject', iss: issuer, sid: 'session' })).rejects.toThrow();
    vi.stubEnv('KEYCLOAK_CLIENT_SECRET', '');
    await expect(introspectAccessToken('token', { sub: 'subject', iss: issuer, sid: 'session' })).rejects.toThrow('credentials');
  });
  it('cannot revoke a session belonging to another user', async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(Response.json([{ id: 'own-session' }]));
    vi.stubGlobal('fetch', fetcher);
    await expect(revokeProviderSession('subject', 'other-session')).rejects.toThrow('does not belong');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// Opt-in real provider tests create and delete only uniquely named test users.
// No realm resets, real-user mutations, or token/credential logging.
describe.skipIf(process.env.RUN_KEYCLOAK_TESTS !== '1')('Live Keycloak issued-token lifecycle', () => {
  const clientId = process.env.KEYCLOAK_TEST_CLIENT_ID || 'iam-test';
  const clientSecret = process.env.KEYCLOAK_TEST_CLIENT_SECRET || 'dev-test-client-secret';
  const password = `${randomUUID()}Aa1!`;
  const users: string[] = [];
  const revocationDelays: number[] = [];
  const apiBase = process.env.KEYCLOAK_TEST_API_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || '3100'}`;
  const maximumRevocationDelayMs = 5000;
  let adminToken: string;
  const realm = new URL(issuer);
  if (process.env.KEYCLOAK_INTERNAL_URL) {
    const internal = new URL(process.env.KEYCLOAK_INTERNAL_URL);
    realm.host = internal.host; realm.protocol = internal.protocol;
  }
  const adminBase = realm.href.replace('/realms/', '/admin/realms/');
  async function admin(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const response = await fetch(`${adminBase}${path}`, {
      method, headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Test provider admin request failed: ${response.status}`);
    return response;
  }
  async function grant(fields: Record<string, string>): Promise<Response> {
    return fetch(`${realm.href}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }), signal: AbortSignal.timeout(5000),
    });
  }
  async function api(token: string, path = '/api/v1/me', method = 'GET'): Promise<Response> {
    return fetch(`${apiBase}${path}`, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  }
  async function login(): Promise<{ access_token: string; refresh_token: string; subject: string; username: string }> {
    const username = `lifecycle-${randomUUID()}`;
    const created = await admin('/users', 'POST', {
      username, enabled: true, emailVerified: true, firstName: 'Lifecycle', lastName: 'Test',
      email: `${username}@example.invalid`, credentials: [{ type: 'password', value: password, temporary: false }],
    });
    const subject = created.headers.get('location')!.split('/').pop()!;
    users.push(subject);
    const response = await grant({ grant_type: 'password', username, password, scope: 'openid' });
    if (!response.ok) throw new Error(`Test provider login failed: ${response.status}`);
    const tokens = await response.json() as { access_token: string; refresh_token: string };
    await expect(validateAccessToken(tokens.access_token, options)).resolves.toBeDefined();
    expect((await api(tokens.access_token)).status).toBe(200);
    return { ...tokens, subject, username };
  }
  async function inactive(token: string): Promise<void> {
    await expect(validateAccessToken(token, options)).rejects.toThrow();
    await expect(introspectAccessToken(token, jose.decodeJwt(token))).rejects.toThrow('inactive');
  }
  async function rejectedAfterRevocation(token: string, started: number, operation: string): Promise<void> {
    // First request after the provider acknowledges revocation; no retry hides a stale acceptance.
    expect((await api(token)).status).toBe(401);
    const delayMs = Math.ceil(performance.now() - started);
    revocationDelays.push(delayMs);
    expect(delayMs).toBeLessThanOrEqual(maximumRevocationDelayMs);
    await inactive(token);
    console.info(JSON.stringify({ event: 'provider-revocation-evidence', operation, firstRequestStatus: 401, delayMs, maximumAllowedMs: maximumRevocationDelayMs }));
  }
  beforeAll(async () => {
    const adminClient = process.env.KEYCLOAK_TEST_ADMIN_CLIENT_ID || process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'iam-provider-admin';
    const adminSecret = process.env.KEYCLOAK_TEST_ADMIN_CLIENT_SECRET || process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    if (!adminSecret) throw new Error('Live tests require an explicitly configured admin test client secret');
    const response = await fetch(`${realm.href}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: adminClient, client_secret: adminSecret }),
    });
    if (!response.ok) throw new Error(`Test admin authentication failed: ${response.status}`);
    adminToken = ((await response.json()) as { access_token: string }).access_token;
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_ID', adminClient); vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_SECRET', adminSecret);
    // Keycloak restricts introspection to the access token's audience. Use backend credentials,
    // not iam-test (the authorized party), exactly as the running API does.
    if (!process.env.KEYCLOAK_CLIENT_SECRET) throw new Error('Live tests require configured backend introspection credentials');
    vi.stubEnv('KEYCLOAK_INTROSPECTION', 'true'); vi.stubEnv('KEYCLOAK_ALLOWED_AZP', '');
    vi.stubEnv('JWT_ISSUER', issuer);
    initJwks(issuer);
  }, 30000);
  afterAll(async () => {
    try {
      for (const user of users) await admin(`/users/${encodeURIComponent(user)}`, 'DELETE');
      // /me JIT creates only these isolated users. Preserve immutable audit evidence.
      if (users.length) {
        const db = getDb();
        const identities = await db.selectFrom('authentication_identities').select('user_id')
          .where('issuer', '=', issuer).where('subject', 'in', users).execute();
        if (identities.length) await db.deleteFrom('users').where('id', 'in', identities.map(identity => identity.user_id)).execute();
      }
      if (revocationDelays.length) console.info(JSON.stringify({ event: 'maximum-observed-revocation-delay', delayMs: Math.max(...revocationDelays), samples: revocationDelays.length }));
    } finally { await closeDb(); vi.unstubAllEnvs(); }
  }, 30000);
  it('provider logout invalidates an already issued access token and refresh token', async () => {
    const token = await login();
    const started = performance.now();
    const logout = await fetch(`${realm.href}/protocol/openid-connect/logout`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: token.refresh_token }),
    });
    expect(logout.ok).toBe(true); await rejectedAfterRevocation(token.access_token, started, 'provider-logout');
    expect((await grant({ grant_type: 'refresh_token', refresh_token: token.refresh_token })).status).toBe(400);
  });
  it('own-session API revoke rejects a foreign session and invalidates only the owned issued token', async () => {
    const token = await login();
    const other = await login();
    const foreignSessions = await listProviderSessions(other.subject);
    expect(foreignSessions.length).toBeGreaterThan(0);
    expect((await api(token.access_token, `/api/v1/sessions/${encodeURIComponent(foreignSessions[0].id)}`, 'DELETE')).status).toBe(403);
    expect((await api(other.access_token)).status).toBe(200);
    const sessions = await listProviderSessions(token.subject);
    expect(sessions.length).toBeGreaterThan(0);
    const started = performance.now();
    expect((await api(token.access_token, `/api/v1/sessions/${encodeURIComponent(sessions[0].id)}`, 'DELETE')).status).toBe(200);
    await rejectedAfterRevocation(token.access_token, started, 'own-session-api-revoke');
    expect((await api(other.access_token)).status).toBe(200);
  });
  it('admin logout-all invalidates issued user session tokens', async () => {
    const token = await login();
    const started = performance.now();
    await resetProviderSessions(token.subject);
    await rejectedAfterRevocation(token.access_token, started, 'admin-logout-all');
  });
  it('genuine admin password reset replaces credentials but does not revoke previously issued access tokens', async () => {
    const token = await login();
    const newPassword = `${randomUUID()}Aa1!`;
    await admin(`/users/${encodeURIComponent(token.subject)}/reset-password`, 'PUT', { type: 'password', value: newPassword, temporary: false });
    const oldLogin = await grant({ grant_type: 'password', username: token.username, password, scope: 'openid' });
    expect(oldLogin.status).toBe(400);
    expect(((await oldLogin.json()) as { error: string }).error).toBe('invalid_grant');
    const newLogin = await grant({ grant_type: 'password', username: token.username, password: newPassword, scope: 'openid' });
    expect(newLogin.status).toBe(200);
    const newTokens = await newLogin.json() as { access_token: string };
    expect((await api(newTokens.access_token)).status).toBe(200);
    const issuedTokenStatus = (await api(token.access_token)).status;
    expect(issuedTokenStatus).toBe(200);
    await expect(introspectAccessToken(token.access_token, jose.decodeJwt(token.access_token))).resolves.toBeUndefined();
    console.info(JSON.stringify({ event: 'password-reset-evidence', oldCredentialsAccepted: false, newCredentialsAccepted: true, previouslyIssuedAccessTokenStatus: issuedTokenStatus }));
  });
  it('expired refresh session is rejected and its issued access token becomes inactive', async () => {
    const token = await login();
    await new Promise(resolve => setTimeout(resolve, 5000));
    expect((await grant({ grant_type: 'refresh_token', refresh_token: token.refresh_token })).status).toBe(400);
    expect((await api(token.access_token)).status).toBe(401);
    await inactive(token.access_token);
  }, 15000);
  it('refresh rotation rejects reuse and invalidates successor refresh and issued access tokens', async () => {
    const token = await login();
    const first = await grant({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
    expect(first.ok).toBe(true);
    const rotated = await first.json() as { access_token: string; refresh_token: string };
    expect(rotated.refresh_token !== token.refresh_token).toBe(true);
    expect((await grant({ grant_type: 'refresh_token', refresh_token: token.refresh_token })).status).toBe(400);
    // Observe reuse handling before any explicit logout, so it cannot masquerade as family revocation.
    const successorRefresh = await grant({ grant_type: 'refresh_token', refresh_token: rotated.refresh_token });
    expect(successorRefresh.status).toBe(400);
    const successorAccessStatus = (await api(rotated.access_token)).status;
    expect(successorAccessStatus).toBe(401);
    await inactive(rotated.access_token);
    console.info(JSON.stringify({ event: 'refresh-reuse-evidence', reusedRefreshStatus: 400, successorRefreshStatus: successorRefresh.status, successorIssuedAccessTokenStatus: successorAccessStatus }));
  });
});
