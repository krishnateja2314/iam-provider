// Final / AG02: user-delegated agents.
// Security invariant 7 (Week 1 design): an agent cannot have more effective permission than its
// delegating user. Effective agent permission = user permission AND delegated scope AND tenant.
// Part 1 (always, real PostgreSQL): signed-fixture tokens through the real Fastify routes.
// Part 2 (RUN_KEYCLOAK_TESTS=1): a real iam-agent-assistant client-credentials token from Keycloak
// against the running API, acting through a delegation row.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { sql } from 'kysely';
import { createTestToken, getTestJwk, SEED_IDS } from '../helpers.js';
import { registerRoutes } from '../../src/routes.js';
import { correlationIdHook } from '../../src/middleware.js';
import { initJwks } from '../../src/modules/auth/token-validator.js';
import { getDb, closeDb } from '../../src/db/connection.js';

// Captured before any block changes the environment.
const LIVE_ISSUER = process.env.JWT_ISSUER || 'http://localhost:8180/realms/iam-platform';
const FIXTURE_ISSUER = 'http://localhost:9083/realms/iam-platform';
const ASSISTANT = 'iam-agent-assistant';
const REPORTER = 'iam-agent-reporting';
const SUBJECT = { alice: '70000000-0000-0000-0000-000000000001', bob: '70000000-0000-0000-0000-000000000002', charlie: '70000000-0000-0000-0000-000000000003' };
const CHARLIE_COURSE1_SUBMISSION = '80000000-0000-0000-0000-000000000001';
const CHARLIE_COURSE2_SUBMISSION = '80000000-0000-0000-0000-000000000002';
const db = getDb();

afterAll(async () => { await closeDb(); });

describe('AG02 user-delegated agent through the API (signed fixtures, real PostgreSQL)', () => {
  let app: FastifyInstance;
  let assistantId: string;
  let reporterId: string;
  const createdSubmissions: string[] = [];

  const human = (subject: string) => createTestToken({ sub: subject, iss: FIXTURE_ISSUER, azp: 'iam-web' });
  const agent = (clientId = ASSISTANT) => createTestToken({ sub: randomUUID(), iss: FIXTURE_ISSUER, azp: clientId, scope: 'iam-api',
    claims: { principal_kind: 'service', client_id: clientId } });
  const call = async (token: string, url: string, opts: { org?: string; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; payload?: unknown; delegation?: string; correlationId?: string } = {}) =>
    app.inject({ method: opts.method ?? 'GET', url, payload: opts.payload as Record<string, unknown> | undefined, headers: {
      authorization: `Bearer ${token}`,
      ...(opts.org ? { 'x-organization-id': opts.org } : {}),
      ...(opts.delegation ? { 'x-delegation-id': opts.delegation } : {}),
      ...(opts.correlationId ? { 'x-correlation-id': opts.correlationId } : {}),
    } });
  /** Create a delegation through the real API as the given user. */
  async function delegate(subject: string, org: string, scopes: string[], agentClientId = ASSISTANT, expiresInSeconds = 600): Promise<string> {
    const response = await call(await human(subject), '/api/v1/delegations', { org, method: 'POST', payload: { agentClientId, scopes, expiresInSeconds } });
    expect(response.statusCode).toBe(201);
    return (response.json() as { delegation: { id: string } }).delegation.id;
  }

  beforeAll(async () => {
    process.env.JWT_ISSUER = FIXTURE_ISSUER;
    process.env.JWT_AUDIENCE = 'iam-backend';
    process.env.KEYCLOAK_INTROSPECTION = 'false';
    process.env.KEYCLOAK_ALLOWED_AZP = 'iam-web';
    initJwks(FIXTURE_ISSUER, jose.createLocalJWKSet({ keys: [await getTestJwk()] }));
    for (const [subject, userId] of [[SUBJECT.alice, SEED_IDS.USER_ALICE], [SUBJECT.bob, SEED_IDS.USER_BOB], [SUBJECT.charlie, SEED_IDS.USER_CHARLIE]]) {
      await db.insertInto('authentication_identities').values({ user_id: userId, issuer: FIXTURE_ISSUER, subject, email: null, email_verified: false })
        .onConflict(oc => oc.columns(['issuer', 'subject']).doNothing()).execute();
    }
    assistantId = (await db.insertInto('service_principals').values({ issuer: FIXTURE_ISSUER, client_id: ASSISTANT, display_name: 'Fixture assistant agent', status: 'active', delegable: true })
      .returning('id').executeTakeFirstOrThrow()).id;
    // A registered but NOT delegable agent, with its own AG01-style grant.
    reporterId = (await db.insertInto('service_principals').values({ issuer: FIXTURE_ISSUER, client_id: REPORTER, display_name: 'Fixture reporting agent', status: 'active' })
      .returning('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('service_principal_grants').values({ service_principal_id: reporterId, organization_id: SEED_IDS.ORG_ACME, resource: 'learning-resource', action: 'list', granted_by: null }).execute();
    app = Fastify({ logger: false });
    app.addHook('onRequest', correlationIdHook);
    registerRoutes(app);
    await app.ready();
  });
  afterAll(async () => {
    if (createdSubmissions.length) await db.deleteFrom('submissions').where('id', 'in', createdSubmissions).execute();
    await db.updateTable('submissions').set({ grade: null }).where('id', 'in', [CHARLIE_COURSE1_SUBMISSION, CHARLIE_COURSE2_SUBMISSION]).execute();
    await db.deleteFrom('service_principals').where('issuer', '=', FIXTURE_ISSUER).execute();
    await db.deleteFrom('authentication_identities').where('issuer', '=', FIXTURE_ISSUER).execute();
    if (app) await app.close();
  });

  it('a user delegates scopes to the assistant in their tenant (201) and sees it listed as active', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list', 'submission:list']);
    const listed = await call(await human(SUBJECT.charlie), '/api/v1/delegations', { org: SEED_IDS.ORG_ACME });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { delegations: { id: string; active: boolean; agentClientId: string; scopes: string[] }[] }).delegations)
      .toContainEqual(expect.objectContaining({ id, active: true, agentClientId: ASSISTANT, scopes: ['learning-resource:list', 'submission:list'] }));
  });

  it('acts for the delegator inside the scope: resource list 200 (published only) and only the delegator\'s own submissions', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list', 'submission:list']);
    const token = await agent();
    const resources = await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id });
    expect(resources.statusCode).toBe(200);
    const rows = (resources.json() as { resources: { organization_id: string; status: string }[] }).resources;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.organization_id === SEED_IDS.ORG_ACME && row.status === 'published')).toBe(true);
    const submissions = await call(token, '/api/v1/submissions', { org: SEED_IDS.ORG_ACME, delegation: id });
    expect(submissions.statusCode).toBe(200);
    const own = (submissions.json() as { submissions: { user_id: string }[] }).submissions;
    expect(own.length).toBeGreaterThan(0);
    expect(own.every(row => row.user_id === SEED_IDS.USER_CHARLIE)).toBe(true);
  });

  it('a delegated scope the user does not hold grants nothing: learner + submission:grade cannot grade (403)', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['submission:grade', 'submission:read']);
    const response = await call(await agent(), `/api/v1/submissions/${CHARLIE_COURSE1_SUBMISSION}/grade`, { org: SEED_IDS.ORG_ACME, method: 'PATCH', payload: { grade: 100 }, delegation: id });
    expect(response.statusCode).toBe(403);
    const row = await db.selectFrom('submissions').select('grade').where('id', '=', CHARLIE_COURSE1_SUBMISSION).executeTakeFirstOrThrow();
    expect(row.grade).toBeNull();
  });

  it('a permission the user holds but did not delegate is denied: single-resource read without learning-resource:read (403)', async () => {
    const courseUrl = `/api/v1/resources/${SEED_IDS.RES_ACME_COURSE1}`;
    expect((await call(await human(SUBJECT.charlie), courseUrl, { org: SEED_IDS.ORG_ACME })).statusCode).toBe(200);
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    const response = await call(await agent(), courseUrl, { org: SEED_IDS.ORG_ACME, delegation: id });
    expect(response.statusCode).toBe(403);
  });

  it('a delegation is bound to one tenant: Alice\'s Acme delegation is refused in Globex, where Alice is also a member (403)', async () => {
    const id = await delegate(SUBJECT.alice, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    const token = await agent();
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(200);
    const globex = await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_GLOBEX, delegation: id });
    expect(globex.statusCode).toBe(403);
    expect(globex.json().code).toBe('TENANT_ACCESS_DENIED');
  });

  it('administrative scopes are never delegable, even by a tenant admin (400, no row)', async () => {
    const before = await db.selectFrom('agent_delegations').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', SEED_IDS.USER_ALICE).executeTakeFirstOrThrow();
    for (const scope of ['member:manage', 'policy:manage', 'audit:read', 'consent:manage', 'learning-resource:create']) {
      const response = await call(await human(SUBJECT.alice), '/api/v1/delegations', { org: SEED_IDS.ORG_ACME, method: 'POST',
        payload: { agentClientId: ASSISTANT, scopes: ['learning-resource:list', scope], expiresInSeconds: 600 } });
      expect({ scope, status: response.statusCode, code: response.json().code }).toEqual({ scope, status: 400, code: 'SCOPE_NOT_DELEGABLE' });
    }
    const after = await db.selectFrom('agent_delegations').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', SEED_IDS.USER_ALICE).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it('an admin\'s agent still cannot reach admin routes: members, audit, policy and resource creation (403)', async () => {
    const id = await delegate(SUBJECT.alice, SEED_IDS.ORG_ACME, ['learning-resource:list', 'learning-resource:read', 'submission:list', 'submission:read', 'submission:grade', 'profile:read']);
    const token = await agent();
    const attempts: [string, 'GET' | 'POST', unknown?][] = [
      ['/api/v1/members', 'GET'], ['/api/v1/audit-events', 'GET'], ['/api/v1/sso-config', 'GET'],
      ['/api/v1/members', 'POST', { userId: SEED_IDS.USER_EVE, roleName: 'admin' }],
      ['/api/v1/policies', 'POST', { roleName: 'learner', resource: 'audit', action: 'read', effect: 'allow' }],
      ['/api/v1/resources', 'POST', { title: 'Delegated-agent course' }],
    ];
    for (const [url, method, payload] of attempts) {
      const response = await call(token, url, { org: SEED_IDS.ORG_ACME, method, payload, delegation: id });
      expect({ url, method, status: response.statusCode }).toEqual({ url, method, status: 403 });
    }
    expect(await db.selectFrom('learning_resources').select('id').where('title', '=', 'Delegated-agent course').execute()).toHaveLength(0);
  });

  it('the teaching relationship still applies: an instructor\'s agent grades a taught course (200) but not an untaught one (403)', async () => {
    const id = await delegate(SUBJECT.bob, SEED_IDS.ORG_ACME, ['submission:grade']);
    const token = await agent();
    const taught = await call(token, `/api/v1/submissions/${CHARLIE_COURSE1_SUBMISSION}/grade`, { org: SEED_IDS.ORG_ACME, method: 'PATCH', payload: { grade: 77 }, delegation: id });
    expect(taught.statusCode).toBe(200);
    const untaught = await call(token, `/api/v1/submissions/${CHARLIE_COURSE2_SUBMISSION}/grade`, { org: SEED_IDS.ORG_ACME, method: 'PATCH', payload: { grade: 77 }, delegation: id });
    expect(untaught.statusCode).toBe(403);
    const grades = await db.selectFrom('submissions').select(['id', 'grade']).where('id', 'in', [CHARLIE_COURSE1_SUBMISSION, CHARLIE_COURSE2_SUBMISSION]).execute();
    expect(Object.fromEntries(grades.map(row => [row.id, row.grade === null ? null : Number(row.grade)]))).toEqual({ [CHARLIE_COURSE1_SUBMISSION]: 77, [CHARLIE_COURSE2_SUBMISSION]: null });
  });

  it('a submission made through a delegation belongs to the delegator and is audited with the agent as actor', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['submission:submit']);
    const correlationId = randomUUID();
    const response = await call(await agent(), '/api/v1/submissions', { org: SEED_IDS.ORG_ACME, method: 'POST', delegation: id, correlationId,
      payload: { courseId: SEED_IDS.RES_ACME_COURSE1, content: 'Submitted by the assistant for Charlie' } });
    expect(response.statusCode).toBe(200);
    const submission = (response.json() as { submission: { id: string; user_id: string } }).submission;
    createdSubmissions.push(submission.id);
    expect(submission.user_id).toBe(SEED_IDS.USER_CHARLIE);
    const audit = await db.selectFrom('audit_events').select(['actor_type', 'actor_id', 'subject_id', 'action', 'metadata']).where('correlation_id', '=', correlationId).execute();
    expect(audit).toEqual([expect.objectContaining({ actor_type: 'service', actor_id: assistantId, subject_id: SEED_IDS.USER_CHARLIE, action: 'submission.submit',
      metadata: { clientId: ASSISTANT, delegationId: id, onBehalfOf: SEED_IDS.USER_CHARLIE } })]);
  });

  it('revocation applies on the agent\'s next request (401); a second revoke and another user\'s revoke are 404', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    const token = await agent();
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(200);
    expect((await call(await human(SUBJECT.bob), `/api/v1/delegations/${id}`, { org: SEED_IDS.ORG_ACME, method: 'DELETE' })).statusCode).toBe(404);
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(200);
    expect((await call(await human(SUBJECT.charlie), `/api/v1/delegations/${id}`, { org: SEED_IDS.ORG_ACME, method: 'DELETE' })).statusCode).toBe(200);
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(401);
    expect((await call(await human(SUBJECT.charlie), `/api/v1/delegations/${id}`, { org: SEED_IDS.ORG_ACME, method: 'DELETE' })).statusCode).toBe(404);
  });

  it('an expired delegation is refused (401)', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    await db.updateTable('agent_delegations').set({ created_at: sql<Date>`now() - interval '2 hours'`, expires_at: sql<Date>`now() - interval '1 second'` }).where('id', '=', id).execute();
    expect((await call(await agent(), '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(401);
  });

  it('when the delegator loses the role, the agent loses it on the next request (403), and regains nothing extra after', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    const token = await agent();
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(200);
    await db.deleteFrom('membership_roles').where('membership_id', '=', SEED_IDS.MEM_CHARLIE_ACME).where('role_id', '=', SEED_IDS.ROLE_ACME_LEARNER).execute();
    try {
      expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(403);
    } finally {
      await db.insertInto('membership_roles').values({ membership_id: SEED_IDS.MEM_CHARLIE_ACME, role_id: SEED_IDS.ROLE_ACME_LEARNER }).execute();
    }
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(200);
  });

  it('when the delegator\'s membership is suspended, the agent is refused at the tenant gate (403)', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    await db.updateTable('memberships').set({ status: 'suspended' }).where('id', '=', SEED_IDS.MEM_CHARLIE_ACME).execute();
    try {
      const response = await call(await agent(), '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('TENANT_ACCESS_DENIED');
    } finally {
      await db.updateTable('memberships').set({ status: 'active' }).where('id', '=', SEED_IDS.MEM_CHARLIE_ACME).execute();
    }
  });

  it('only the named agent can use a delegation; a non-delegable agent can neither use nor receive one', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    expect((await call(await agent(REPORTER), '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(401);
    for (const agentClientId of [REPORTER, `iam-agent-unknown-${randomUUID().slice(0, 8)}`]) {
      const response = await call(await human(SUBJECT.charlie), '/api/v1/delegations', { org: SEED_IDS.ORG_ACME, method: 'POST',
        payload: { agentClientId, scopes: ['learning-resource:list'], expiresInSeconds: 600 } });
      expect({ agentClientId, status: response.statusCode, code: response.json().code }).toEqual({ agentClientId, status: 400, code: 'AGENT_NOT_DELEGABLE' });
    }
  });

  it('a registry-disabled assistant cannot act through an existing delegation (401)', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    await db.updateTable('service_principals').set({ status: 'disabled' }).where('id', '=', assistantId).execute();
    try {
      expect((await call(await agent(), '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id })).statusCode).toBe(401);
    } finally {
      await db.updateTable('service_principals').set({ status: 'active' }).where('id', '=', assistantId).execute();
    }
  });

  it('without a delegation the assistant has no authority of its own (403); a malformed or unknown delegation is 401', async () => {
    const token = await agent();
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME })).statusCode).toBe(403);
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: 'not-a-uuid' })).statusCode).toBe(401);
    expect((await call(token, '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: randomUUID() })).statusCode).toBe(401);
  });

  it('a delegated agent cannot re-delegate or use human-only routes (403 PRINCIPAL_KIND_NOT_ALLOWED)', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    const token = await agent();
    for (const [url, method, payload, org] of [
      ['/api/v1/delegations', 'POST', { agentClientId: ASSISTANT, scopes: ['learning-resource:list'], expiresInSeconds: 600 }, SEED_IDS.ORG_ACME],
      ['/api/v1/delegations', 'GET', undefined, SEED_IDS.ORG_ACME],
      [`/api/v1/delegations/${id}`, 'DELETE', undefined, SEED_IDS.ORG_ACME],
      ['/api/v1/me', 'GET', undefined, undefined], ['/api/v1/sessions', 'GET', undefined, undefined],
      ['/api/v1/consents', 'POST', { purpose: 'analytics', granted: true }, SEED_IDS.ORG_ACME],
    ] as [string, 'GET' | 'POST' | 'DELETE', unknown, string | undefined][]) {
      const response = await call(token, url, { org, method, payload, delegation: id });
      expect({ url, method, status: response.statusCode, code: response.json().code }).toEqual({ url, method, status: 403, code: 'PRINCIPAL_KIND_NOT_ALLOWED' });
    }
  });

  it('a human credential carrying X-Delegation-ID is refused (400)', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    const response = await call(await human(SUBJECT.bob), '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('DELEGATION_NOT_ALLOWED');
  });

  it('a tenant deny policy stops users creating delegations, but never stops them revoking one', async () => {
    const id = await delegate(SUBJECT.charlie, SEED_IDS.ORG_ACME, ['learning-resource:list']);
    const policy = await db.insertInto('policy_rules').values({ id: randomUUID(), organization_id: SEED_IDS.ORG_ACME, role_name: 'learner', resource: 'delegation', action: 'manage', effect: 'deny' })
      .returning('id').executeTakeFirstOrThrow();
    try {
      const created = await call(await human(SUBJECT.charlie), '/api/v1/delegations', { org: SEED_IDS.ORG_ACME, method: 'POST',
        payload: { agentClientId: ASSISTANT, scopes: ['learning-resource:list'], expiresInSeconds: 600 } });
      expect(created.statusCode).toBe(403);
      expect((await call(await human(SUBJECT.charlie), `/api/v1/delegations/${id}`, { org: SEED_IDS.ORG_ACME, method: 'DELETE' })).statusCode).toBe(200);
    } finally {
      await db.deleteFrom('policy_rules').where('id', '=', policy.id).execute();
    }
  });

  it('delegation and revocation are audited with the user as actor; agent calls name agent, delegation and delegator', async () => {
    const createCorrelation = randomUUID(); const useCorrelation = randomUUID(); const revokeCorrelation = randomUUID();
    const created = await call(await human(SUBJECT.charlie), '/api/v1/delegations', { org: SEED_IDS.ORG_ACME, method: 'POST', correlationId: createCorrelation,
      payload: { agentClientId: ASSISTANT, scopes: ['learning-resource:list'], expiresInSeconds: 600 } });
    const id = (created.json() as { delegation: { id: string } }).delegation.id;
    expect((await call(await agent(), '/api/v1/resources', { org: SEED_IDS.ORG_ACME, delegation: id, correlationId: useCorrelation })).statusCode).toBe(200);
    expect((await call(await human(SUBJECT.charlie), `/api/v1/delegations/${id}`, { org: SEED_IDS.ORG_ACME, method: 'DELETE', correlationId: revokeCorrelation })).statusCode).toBe(200);
    const rows = await db.selectFrom('audit_events').select(['correlation_id', 'actor_type', 'actor_id', 'subject_id', 'organization_id', 'action', 'decision', 'resource_id', 'metadata'])
      .where('correlation_id', 'in', [createCorrelation, useCorrelation, revokeCorrelation]).execute();
    const of = (correlation: string) => rows.filter(row => row.correlation_id === correlation);
    expect(of(createCorrelation)).toEqual([expect.objectContaining({ actor_type: 'user', actor_id: SEED_IDS.USER_CHARLIE, action: 'delegation.create', decision: 'allow', resource_id: id, organization_id: SEED_IDS.ORG_ACME })]);
    expect(of(useCorrelation)).toEqual([expect.objectContaining({ actor_type: 'service', actor_id: assistantId, subject_id: SEED_IDS.USER_CHARLIE, action: 'resource.list', decision: 'allow',
      metadata: { clientId: ASSISTANT, delegationId: id, onBehalfOf: SEED_IDS.USER_CHARLIE } })]);
    expect(of(revokeCorrelation)).toEqual([expect.objectContaining({ actor_type: 'user', actor_id: SEED_IDS.USER_CHARLIE, action: 'delegation.revoke', resource_id: id })]);
  });

  it('the database refuses a delegation in a tenant where the user has no membership', async () => {
    await expect(db.insertInto('agent_delegations').values({ service_principal_id: assistantId, user_id: SEED_IDS.USER_CHARLIE, organization_id: SEED_IDS.ORG_GLOBEX,
      scopes: ['learning-resource:list'], expires_at: new Date(Date.now() + 60000), revoked_at: null }).execute()).rejects.toThrow(/agent_delegation_membership/);
  });

  it('schema validation rejects bad expiry, empty scopes and unknown scopes (400)', async () => {
    const token = await human(SUBJECT.charlie);
    for (const payload of [
      { agentClientId: ASSISTANT, scopes: ['learning-resource:list'], expiresInSeconds: 10 },
      { agentClientId: ASSISTANT, scopes: ['learning-resource:list'], expiresInSeconds: 31 * 24 * 3600 },
      { agentClientId: ASSISTANT, scopes: [], expiresInSeconds: 600 },
      { agentClientId: ASSISTANT, scopes: ['everything:*'], expiresInSeconds: 600 },
    ]) {
      expect((await call(token, '/api/v1/delegations', { org: SEED_IDS.ORG_ACME, method: 'POST', payload })).statusCode).toBe(400);
    }
  });
});

// Live: a real client-credentials token for iam-agent-assistant from Keycloak against the running API.
describe.skipIf(process.env.RUN_KEYCLOAK_TESTS !== '1')('AG02 live: iam-agent-assistant acting through a delegation against the running API', () => {
  const apiBase = process.env.KEYCLOAK_TEST_API_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || '3100'}`;
  const secret = process.env.KEYCLOAK_ASSISTANT_CLIENT_SECRET || 'dev-agent-assistant-secret';
  const realm = new URL(LIVE_ISSUER);
  if (process.env.KEYCLOAK_INTERNAL_URL) {
    const internal = new URL(process.env.KEYCLOAK_INTERNAL_URL);
    realm.host = internal.host; realm.protocol = internal.protocol;
  }
  let assistantId: string;
  const delegations: string[] = [];

  async function agentToken(): Promise<string> {
    const response = await fetch(`${realm.href}/protocol/openid-connect/token`, { method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: ASSISTANT, client_secret: secret }) });
    if (!response.ok) throw new Error(`Assistant token request failed: ${response.status}`);
    return ((await response.json()) as { access_token: string }).access_token;
  }
  const api = (token: string, path: string, org?: string, delegation?: string) => fetch(`${apiBase}${path}`, { signal: AbortSignal.timeout(5000), headers: {
    authorization: `Bearer ${token}`, ...(org ? { 'x-organization-id': org } : {}), ...(delegation ? { 'x-delegation-id': delegation } : {}) } });
  async function liveDelegation(scopes: string[]): Promise<string> {
    const row = await db.insertInto('agent_delegations').values({ service_principal_id: assistantId, user_id: SEED_IDS.USER_CHARLIE, organization_id: SEED_IDS.ORG_ACME,
      scopes, expires_at: new Date(Date.now() + 10 * 60000), revoked_at: null }).returning('id').executeTakeFirstOrThrow();
    delegations.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const principal = await db.selectFrom('service_principals').select(['id', 'status', 'delegable']).where('issuer', '=', LIVE_ISSUER).where('client_id', '=', ASSISTANT).executeTakeFirst();
    if (!principal || principal.status !== 'active' || !principal.delegable) throw new Error('Assistant agent not registered as delegable; restart the backend so the seed runs');
    assistantId = principal.id;
  });
  afterAll(async () => {
    if (delegations.length) await db.deleteFrom('agent_delegations').where('id', 'in', delegations).execute();
  });

  it('the provider issues a service token for the assistant: principal_kind=service, no user session, no realm roles', async () => {
    const claims = jose.decodeJwt(await agentToken());
    expect({ iss: claims.iss, aud: claims.aud, azp: claims.azp, principal_kind: claims.principal_kind, sid: claims.sid })
      .toEqual({ iss: LIVE_ISSUER, aud: 'iam-backend', azp: ASSISTANT, principal_kind: 'service', sid: undefined });
    expect(claims.realm_access).toBeUndefined();
  });

  it('without a delegation the assistant is refused in Acme (403)', async () => {
    expect((await api(await agentToken(), '/api/v1/resources', SEED_IDS.ORG_ACME)).status).toBe(403);
  });

  it('with Charlie\'s delegation: resources 200, only Charlie\'s submissions, members 403, Globex 403', async () => {
    const id = await liveDelegation(['learning-resource:list', 'submission:list']);
    const token = await agentToken();
    expect((await api(token, '/api/v1/resources', SEED_IDS.ORG_ACME, id)).status).toBe(200);
    const submissions = await api(token, '/api/v1/submissions', SEED_IDS.ORG_ACME, id);
    expect(submissions.status).toBe(200);
    const rows = ((await submissions.json()) as { submissions: { user_id: string }[] }).submissions;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.user_id === SEED_IDS.USER_CHARLIE)).toBe(true);
    expect((await api(token, '/api/v1/members', SEED_IDS.ORG_ACME, id)).status).toBe(403);
    expect((await api(token, '/api/v1/resources', SEED_IDS.ORG_GLOBEX, id)).status).toBe(403);
  });

  it('revoking the delegation denies the already-issued agent token on its next request (401)', async () => {
    const id = await liveDelegation(['learning-resource:list']);
    const token = await agentToken();
    expect((await api(token, '/api/v1/resources', SEED_IDS.ORG_ACME, id)).status).toBe(200);
    const started = performance.now();
    await db.updateTable('agent_delegations').set({ revoked_at: new Date() }).where('id', '=', id).execute();
    const status = (await api(token, '/api/v1/resources', SEED_IDS.ORG_ACME, id)).status;
    const delayMs = Math.ceil(performance.now() - started);
    expect(status).toBe(401);
    console.info(JSON.stringify({ event: 'delegation-revocation-evidence', firstRequestStatus: status, delayMs }));
  });
});
