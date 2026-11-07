// W5 / AG01: application service principal (reporting agent).
// Part 1 (always, real PostgreSQL): signed-fixture tokens through the real Fastify routes.
// Part 2 (always): provider introspection binding for service tokens, with a mocked provider.
// Part 3 (RUN_KEYCLOAK_TESTS=1): real client-credentials tokens from Keycloak against the running API.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { createTestToken, getTestJwk, SEED_IDS } from '../helpers.js';
import { registerRoutes } from '../../src/routes.js';
import { correlationIdHook } from '../../src/middleware.js';
import { initJwks } from '../../src/modules/auth/token-validator.js';
import { introspectServiceToken } from '../../src/modules/auth/session-service.js';
import { AuthenticationError, DependencyError } from '../../src/common/types.js';
import { getDb, closeDb } from '../../src/db/connection.js';

// Captured before any block changes the environment.
const LIVE_ISSUER = process.env.JWT_ISSUER || 'http://localhost:8180/realms/iam-platform';
const FIXTURE_ISSUER = 'http://localhost:9081/realms/iam-platform';
const AGENT = 'iam-agent-reporting';
const db = getDb();

afterAll(async () => { await closeDb(); });

describe('AG01 service principal through the API (signed fixtures, real PostgreSQL)', () => {
  let app: FastifyInstance;
  let agentId: string;
  const disabledClient = `iam-agent-disabled-${randomUUID().slice(0, 8)}`;
  const tempSlug = `sp-${randomUUID().slice(0, 8)}`;
  let tempOrg: string;

  const serviceToken = (clientId = AGENT, extra: Record<string, unknown> = {}, sub = randomUUID()) => createTestToken({
    sub, iss: FIXTURE_ISSUER, azp: clientId, scope: 'iam-api',
    claims: { principal_kind: 'service', client_id: clientId, ...extra },
  });
  const call = async (token: string, url: string, org?: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', payload?: unknown, correlationId?: string) =>
    app.inject({ method, url, payload: payload as Record<string, unknown> | undefined, headers: {
      authorization: `Bearer ${token}`, ...(org ? { 'x-organization-id': org } : {}), ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    } });

  beforeAll(async () => {
    process.env.JWT_ISSUER = FIXTURE_ISSUER;
    process.env.JWT_AUDIENCE = 'iam-backend';
    process.env.KEYCLOAK_INTROSPECTION = 'false';
    // Human clients stay allowlisted; service clients are allowlisted only by the registry.
    process.env.KEYCLOAK_ALLOWED_AZP = 'iam-web';
    initJwks(FIXTURE_ISSUER, jose.createLocalJWKSet({ keys: [await getTestJwk()] }));
    const agent = await db.insertInto('service_principals').values({ issuer: FIXTURE_ISSUER, client_id: AGENT, display_name: 'Fixture reporting agent', status: 'active' })
      .returning('id').executeTakeFirstOrThrow();
    agentId = agent.id;
    const disabled = await db.insertInto('service_principals').values({ issuer: FIXTURE_ISSUER, client_id: disabledClient, display_name: 'Fixture disabled agent', status: 'disabled' })
      .returning('id').executeTakeFirstOrThrow();
    const org = await db.insertInto('organizations').values({ name: 'Service principal fixture', slug: tempSlug, status: 'active' }).returning('id').executeTakeFirstOrThrow();
    tempOrg = org.id;
    await db.insertInto('service_principal_grants').values([
      { service_principal_id: agentId, organization_id: SEED_IDS.ORG_ACME, resource: 'learning-resource', action: 'list', granted_by: null },
      { service_principal_id: agentId, organization_id: tempOrg, resource: 'learning-resource', action: 'list', granted_by: null },
      { service_principal_id: disabled.id, organization_id: SEED_IDS.ORG_ACME, resource: 'learning-resource', action: 'list', granted_by: null },
    ]).execute();
    app = Fastify({ logger: false });
    app.addHook('onRequest', correlationIdHook);
    registerRoutes(app);
    await app.ready();
  });
  afterAll(async () => {
    await db.deleteFrom('service_principals').where('issuer', '=', FIXTURE_ISSUER).execute();
    await db.deleteFrom('organizations').where('slug', '=', tempSlug).execute();
    if (app) await app.close();
  });

  it('lists only published Acme resources with its single grant (200)', async () => {
    const response = await call(await serviceToken(), '/api/v1/resources', SEED_IDS.ORG_ACME);
    expect(response.statusCode).toBe(200);
    const { resources, organizationId } = response.json() as { resources: { organization_id: string; status: string }[]; organizationId: string };
    expect(organizationId).toBe(SEED_IDS.ORG_ACME);
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.every(resource => resource.organization_id === SEED_IDS.ORG_ACME && resource.status === 'published')).toBe(true);
  });

  it('is refused in Globex, where it holds no grant (403)', async () => {
    const response = await call(await serviceToken(), '/api/v1/resources', SEED_IDS.ORG_GLOBEX);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('TENANT_ACCESS_DENIED');
  });

  it('cannot perform admin or other ungranted actions in Acme (403)', async () => {
    const token = await serviceToken();
    const attempts: [string, 'GET' | 'POST', unknown?][] = [
      ['/api/v1/members', 'GET'],
      ['/api/v1/audit-events', 'GET'],
      ['/api/v1/sso-config', 'GET'],
      ['/api/v1/submissions', 'GET'],
      ['/api/v1/teaching-assignments', 'GET'],
      [`/api/v1/resources/${SEED_IDS.RES_ACME_COURSE1}`, 'GET'],
      ['/api/v1/resources?status=draft', 'GET'],
      ['/api/v1/resources', 'POST', { title: 'Agent-created course' }],
      ['/api/v1/members', 'POST', { userId: SEED_IDS.USER_EVE, roleName: 'admin' }],
      ['/api/v1/policies', 'POST', { roleName: 'learner', resource: 'audit', action: 'read', effect: 'allow' }],
    ];
    for (const [url, method, payload] of attempts) {
      const response = await call(token, url, SEED_IDS.ORG_ACME, method, payload);
      expect({ url, method, status: response.statusCode }).toEqual({ url, method, status: 403 });
    }
    const created = await db.selectFrom('learning_resources').select('id').where('title', '=', 'Agent-created course').execute();
    expect(created).toHaveLength(0);
  });

  it('human-only routes refuse service principals (403 PRINCIPAL_KIND_NOT_ALLOWED)', async () => {
    const token = await serviceToken();
    for (const [url, method, payload] of [
      ['/api/v1/me', 'GET'], ['/api/v1/organizations', 'GET'], ['/api/v1/sessions', 'GET'], ['/api/v1/logout-all', 'POST'],
      ['/api/v1/organizations', 'POST', { name: 'Agent tenant', slug: `agent-${randomUUID().slice(0, 8)}`, adminUserId: SEED_IDS.USER_ALICE }],
    ] as [string, 'GET' | 'POST', unknown?][]) {
      const response = await call(token, url, undefined, method, payload);
      expect({ url, method, status: response.statusCode, code: response.json().code }).toEqual({ url, method, status: 403, code: 'PRINCIPAL_KIND_NOT_ALLOWED' });
    }
    const consent = await call(token, '/api/v1/consents', SEED_IDS.ORG_ACME, 'POST', { purpose: 'analytics', granted: false });
    expect(consent.statusCode).toBe(403);
  });

  it('unregistered and disabled service principals are rejected with 401', async () => {
    const unknown = await call(await serviceToken(`iam-agent-unknown-${randomUUID().slice(0, 8)}`), '/api/v1/resources', SEED_IDS.ORG_ACME);
    expect(unknown.statusCode).toBe(401);
    const disabled = await call(await serviceToken(disabledClient), '/api/v1/resources', SEED_IDS.ORG_ACME);
    expect(disabled.statusCode).toBe(401);
  });

  it('an expired service token is rejected with 401', async () => {
    const token = await createTestToken({ sub: randomUUID(), iss: FIXTURE_ISSUER, azp: AGENT, exp: Math.floor(Date.now() / 1000) - 5,
      claims: { principal_kind: 'service', client_id: AGENT } });
    expect((await call(token, '/api/v1/resources', SEED_IDS.ORG_ACME)).statusCode).toBe(401);
  });

  it.each([
    ['carries a user session (sid)', { sid: 'user-session' }],
    ['carries a user session (session_state)', { session_state: 'user-session' }],
    ['claims a different client_id', { client_id: 'iam-web' }],
    ['uses an unknown principal kind', { principal_kind: 'robot' }],
    ['uses a non-string principal kind', { principal_kind: ['service'] }],
  ])('a service token that %s is rejected with 401', async (_label, extra) => {
    expect((await call(await serviceToken(AGENT, extra), '/api/v1/resources', SEED_IDS.ORG_ACME)).statusCode).toBe(401);
  });

  it('a token for the agent client without principal_kind is judged as a human token and fails the human allowlist', async () => {
    const token = await createTestToken({ sub: randomUUID(), iss: FIXTURE_ISSUER, azp: AGENT });
    expect((await call(token, '/api/v1/me')).statusCode).toBe(401);
  });

  it('never creates a user, identity or membership for a service token', async () => {
    const sub = randomUUID();
    expect((await call(await serviceToken(AGENT, {}, sub), '/api/v1/resources', SEED_IDS.ORG_ACME)).statusCode).toBe(200);
    const identities = await db.selectFrom('authentication_identities').select('id').where('subject', '=', sub).execute();
    expect(identities).toHaveLength(0);
    const memberships = await db.selectFrom('memberships').select('id').where('user_id', '=', agentId).execute();
    expect(memberships).toHaveLength(0);
  });

  it('a suspended tenant denies the service principal even with a grant', async () => {
    const token = await serviceToken();
    expect((await call(token, '/api/v1/resources', tempOrg)).statusCode).toBe(200);
    await db.updateTable('organizations').set({ status: 'suspended' }).where('id', '=', tempOrg).execute();
    expect((await call(token, '/api/v1/resources', tempOrg)).statusCode).toBe(403);
  });

  it('audit rows record actor_type=service with the service principal as actor and its client', async () => {
    const token = await serviceToken();
    const allowed = randomUUID(); const denied = randomUUID(); const humanOnly = randomUUID();
    expect((await call(token, '/api/v1/resources', SEED_IDS.ORG_ACME, 'GET', undefined, allowed)).statusCode).toBe(200);
    expect((await call(token, '/api/v1/members', SEED_IDS.ORG_ACME, 'GET', undefined, denied)).statusCode).toBe(403);
    expect((await call(token, '/api/v1/me', undefined, 'GET', undefined, humanOnly)).statusCode).toBe(403);
    const rows = await db.selectFrom('audit_events').select(['correlation_id', 'actor_type', 'actor_id', 'subject_id', 'organization_id', 'action', 'decision', 'metadata'])
      .where('correlation_id', 'in', [allowed, denied, humanOnly]).execute();
    const byId = (id: string) => rows.filter(row => row.correlation_id === id);
    expect(byId(allowed)).toEqual([expect.objectContaining({ actor_type: 'service', actor_id: agentId, organization_id: SEED_IDS.ORG_ACME, action: 'resource.list', decision: 'allow', metadata: { clientId: AGENT } })]);
    expect(byId(denied)).toEqual([expect.objectContaining({ actor_type: 'service', actor_id: agentId, action: 'member.manage', decision: 'deny', metadata: { clientId: AGENT } })]);
    expect(byId(humanOnly)).toEqual([expect.objectContaining({ actor_type: 'service', actor_id: agentId, action: 'authentication', decision: 'deny' })]);
  });
});

describe('AG01 provider introspection binding for service tokens', () => {
  const claims = { sub: 'sa-subject', iss: FIXTURE_ISSUER, azp: AGENT };
  const active = { active: true, sub: 'sa-subject', client_id: AGENT, username: `service-account-${AGENT}`, principal_kind: 'service' };
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const provider = (body: unknown) => { vi.stubEnv('KEYCLOAK_CLIENT_SECRET', 'test-only-secret'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body))); };

  it('accepts an active token issued to the same client and bound to its service account', async () => {
    provider(active);
    await expect(introspectServiceToken('token', claims)).resolves.toBeUndefined();
  });
  it('rejects a human user token relabelled as a service token', async () => {
    provider({ ...active, username: 'alice' });
    await expect(introspectServiceToken('token', claims)).rejects.toBeInstanceOf(AuthenticationError);
  });
  it.each([
    ['inactive (client disabled or token expired)', { active: false }],
    ['issued to another client', { ...active, client_id: 'iam-web' }],
    ['for another subject', { ...active, sub: 'other' }],
    ['without the provider principal kind', { ...active, principal_kind: undefined }],
    ['bound to a user session', { ...active, sid: 'user-session' }],
  ])('rejects a token the provider reports %s', async (_label, body) => {
    provider(body);
    await expect(introspectServiceToken('token', claims)).rejects.toBeInstanceOf(AuthenticationError);
  });
  it('a provider outage is a dependency failure (503), not an invalid credential', async () => {
    vi.stubEnv('KEYCLOAK_CLIENT_SECRET', 'test-only-secret');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(introspectServiceToken('token', claims)).rejects.toBeInstanceOf(DependencyError);
  });
});

// Live: real Keycloak client-credentials tokens against the running API. The test toggles only the
// agent client (lifespan, enabled) through the local bootstrap admin and always restores it.
describe.skipIf(process.env.RUN_KEYCLOAK_TESTS !== '1')('AG01 live: iam-agent-reporting client-credentials token against the running API', () => {
  const apiBase = process.env.KEYCLOAK_TEST_API_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || '3100'}`;
  const agentSecret = process.env.KEYCLOAK_AGENT_CLIENT_SECRET || 'dev-agent-reporting-secret';
  const realm = new URL(LIVE_ISSUER);
  if (process.env.KEYCLOAK_INTERNAL_URL) {
    const internal = new URL(process.env.KEYCLOAK_INTERNAL_URL);
    realm.host = internal.host; realm.protocol = internal.protocol;
  }
  const adminBase = realm.href.replace('/realms/', '/admin/realms/');
  let adminToken: string;
  let client: Record<string, unknown> & { id: string; attributes?: Record<string, string> };
  let agentId: string;

  async function admin(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const response = await fetch(`${adminBase}${path}`, { method, signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`Test provider admin request failed: ${response.status}`);
    return response;
  }
  async function agentToken(): Promise<{ status: number; token?: string; error?: string }> {
    const response = await fetch(`${realm.href}/protocol/openid-connect/token`, { method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: AGENT, client_secret: agentSecret }) });
    const body = await response.json() as { access_token?: string; error?: string };
    return { status: response.status, token: body.access_token, error: body.error };
  }
  async function api(token: string, path: string, org?: string, correlationId?: string): Promise<Response> {
    return fetch(`${apiBase}${path}`, { signal: AbortSignal.timeout(5000), headers: {
      authorization: `Bearer ${token}`, ...(org ? { 'x-organization-id': org } : {}), ...(correlationId ? { 'x-correlation-id': correlationId } : {}) } });
  }

  beforeAll(async () => {
    // Local synthetic lab only: the bootstrap admin may toggle the agent client; iam-provider-admin
    // deliberately cannot manage clients.
    const master = new URL(realm.href.replace(/\/realms\/[^/]+$/, '/realms/master/protocol/openid-connect/token'));
    const login = await fetch(master, { method: 'POST', signal: AbortSignal.timeout(5000), body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli',
      username: process.env.KEYCLOAK_ADMIN || 'admin', password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin_dev_password' }) });
    if (!login.ok) throw new Error(`Test bootstrap admin authentication failed: ${login.status}`);
    adminToken = ((await login.json()) as { access_token: string }).access_token;
    const found = await (await admin(`/clients?clientId=${AGENT}`)).json() as typeof client[];
    if (found.length !== 1) throw new Error('Agent client not configured; run scripts/configure-keycloak.mjs');
    client = found[0];
    const principal = await db.selectFrom('service_principals').select(['id', 'status']).where('issuer', '=', LIVE_ISSUER).where('client_id', '=', AGENT).executeTakeFirst();
    if (!principal || principal.status !== 'active') throw new Error('Agent service principal not registered; restart the backend so the seed runs');
    agentId = principal.id;
  }, 30000);
  afterAll(async () => {
    // Always restore the configured client, whatever a test did.
    if (client) await admin(`/clients/${client.id}`, 'PUT', client);
  }, 30000);

  it('the provider issues a client-credentials token with the expected audience, principal kind and no user session', async () => {
    const issued = await agentToken();
    expect(issued.status).toBe(200);
    const claims = jose.decodeJwt(issued.token!);
    expect({ iss: claims.iss, aud: claims.aud, azp: claims.azp, typ: claims.typ, principal_kind: claims.principal_kind, sid: claims.sid })
      .toEqual({ iss: LIVE_ISSUER, aud: 'iam-backend', azp: AGENT, typ: 'Bearer', principal_kind: 'service', sid: undefined });
    expect(claims.realm_access).toBeUndefined();
  });

  it('Acme resource list: 200, tenant-filtered and published only', async () => {
    const response = await api((await agentToken()).token!, '/api/v1/resources', SEED_IDS.ORG_ACME);
    expect(response.status).toBe(200);
    const body = await response.json() as { resources: { organization_id: string; status: string }[] };
    expect(body.resources.length).toBeGreaterThan(0);
    expect(body.resources.every(resource => resource.organization_id === SEED_IDS.ORG_ACME && resource.status === 'published')).toBe(true);
  });

  it('Globex: 403', async () => {
    expect((await api((await agentToken()).token!, '/api/v1/resources', SEED_IDS.ORG_GLOBEX)).status).toBe(403);
  });

  it('an admin action in Acme: 403', async () => {
    const token = (await agentToken()).token!;
    for (const path of ['/api/v1/members', '/api/v1/audit-events', '/api/v1/sso-config', `/api/v1/resources/${SEED_IDS.RES_ACME_COURSE1}`]) {
      expect({ path, status: (await api(token, path, SEED_IDS.ORG_ACME)).status }).toEqual({ path, status: 403 });
    }
    expect((await api(token, '/api/v1/me')).status).toBe(403);
  });

  it('an expired token: 401', async () => {
    await admin(`/clients/${client.id}`, 'PUT', { ...client, attributes: { ...client.attributes, 'access.token.lifespan': '2' } });
    let token: string;
    try {
      token = (await agentToken()).token!;
    } finally {
      await admin(`/clients/${client.id}`, 'PUT', client);
    }
    const claims = jose.decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(2);
    await new Promise(resolve => setTimeout(resolve, 3500));
    expect((await api(token, '/api/v1/resources', SEED_IDS.ORG_ACME)).status).toBe(401);
  }, 20000);

  it('an already-issued token after the client is disabled: 401', async () => {
    const token = (await agentToken()).token!;
    expect((await api(token, '/api/v1/resources', SEED_IDS.ORG_ACME)).status).toBe(200);
    let firstStatus: number; let delayMs: number; let newTokenError: string | undefined;
    const started = performance.now();
    await admin(`/clients/${client.id}`, 'PUT', { ...client, enabled: false });
    try {
      // First request after the provider acknowledged the change; no retry.
      firstStatus = (await api(token, '/api/v1/resources', SEED_IDS.ORG_ACME)).status;
      delayMs = Math.ceil(performance.now() - started);
      newTokenError = (await agentToken()).error;
    } finally {
      await admin(`/clients/${client.id}`, 'PUT', client);
    }
    expect(firstStatus).toBe(401);
    expect(newTokenError).toBe('invalid_client');
    console.info(JSON.stringify({ event: 'service-principal-disable-evidence', firstRequestStatus: firstStatus, delayMs, newTokenError }));
  });

  it("audit rows record actor_type='service' with the agent as actor", async () => {
    const token = (await agentToken()).token!;
    const allowed = randomUUID(); const denied = randomUUID();
    expect((await api(token, '/api/v1/resources', SEED_IDS.ORG_ACME, allowed)).status).toBe(200);
    expect((await api(token, '/api/v1/resources', SEED_IDS.ORG_GLOBEX, denied)).status).toBe(403);
    const rows = await db.selectFrom('audit_events').select(['correlation_id', 'actor_type', 'actor_id', 'organization_id', 'action', 'decision', 'metadata'])
      .where('correlation_id', 'in', [allowed, denied]).execute();
    expect(rows.find(row => row.correlation_id === allowed)).toMatchObject({ actor_type: 'service', actor_id: agentId, organization_id: SEED_IDS.ORG_ACME, action: 'resource.list', decision: 'allow', metadata: { clientId: AGENT } });
    expect(rows.find(row => row.correlation_id === denied)).toMatchObject({ actor_type: 'service', actor_id: agentId, organization_id: SEED_IDS.ORG_GLOBEX, action: 'tenant-access', decision: 'deny', metadata: { clientId: AGENT } });
    expect(rows).toHaveLength(2);
  });
});
