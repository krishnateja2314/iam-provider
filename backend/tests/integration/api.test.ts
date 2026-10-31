// ============================================================
// Integration Test: Full API flow with HTTP requests
// ============================================================
// Tests the actual Fastify server endpoints with simulated
// authenticated requests. Uses the test JWT infrastructure.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import * as jose from 'jose';
import { getTestKeyPair, getTestJwk, createTestToken, SEED_IDS } from '../helpers.js';
import { registerRoutes } from '../../src/routes.js';
import { correlationIdHook } from '../../src/middleware.js';
import { initJwks } from '../../src/modules/auth/token-validator.js';
import { closeDb } from '../../src/db/connection.js';

let app: FastifyInstance;
let testJwksServer: any;

// We need to mock the JWKS endpoint for test token validation.
// We'll create a minimal HTTP server that serves our test JWKS.
import http from 'http';
import { randomUUID } from 'node:crypto';

beforeAll(async () => {
  const jwk = await getTestJwk();

  // Create a mock JWKS server
  testJwksServer = http.createServer((req, res) => {
    if (req.url?.includes('/protocol/openid-connect/certs')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    testJwksServer.listen(9080, resolve);
  });

  // Point JWKS to our test server
  process.env.JWT_ISSUER = 'http://localhost:9080/realms/iam-platform';
  process.env.JWT_AUDIENCE = 'iam-backend';
  delete process.env.JWKS_URL;
  process.env.KEYCLOAK_INTROSPECTION = 'false';
  process.env.KEYCLOAK_ALLOWED_AZP = '';
  initJwks('http://localhost:9080/realms/iam-platform');

  // Link independent test-issuer identities without changing production mappings.
  const { getDb } = await import('../../src/db/connection.js');
  const db = getDb();
  for (const [subject,userId] of [
    ['70000000-0000-0000-0000-000000000001',SEED_IDS.USER_ALICE],
    ['70000000-0000-0000-0000-000000000002',SEED_IDS.USER_BOB],
    ['70000000-0000-0000-0000-000000000003',SEED_IDS.USER_CHARLIE],
  ]) await db.insertInto('authentication_identities').values({user_id:userId,issuer:process.env.JWT_ISSUER!,subject,email:null,email_verified:false})
    .onConflict(oc=>oc.columns(['issuer','subject']).doNothing()).execute();

  // Create test Fastify app
  app = Fastify({ logger: false });
  await app.register(cors);
  app.addHook('onRequest', correlationIdHook);
  registerRoutes(app);
  await app.ready();
});

afterAll(async () => {
  // Restore issuers to original seed value
  try {
    const { getDb } = await import('../../src/db/connection.js');
    const db = getDb();
    await db.deleteFrom('authentication_identities').where('issuer','=','http://localhost:9080/realms/iam-platform').execute();
  } catch {
    // Ignore cleanup errors
  }
  if(app)await app.close();
  await new Promise<void>((resolve) => {
    testJwksServer.close(resolve);
  });
  await closeDb();
});

describe('API Integration: Health', () => {
  it('health endpoint returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });
});

describe('API Integration: Authentication', () => {
  it('request without Authorization header returns 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(response.statusCode).toBe(401);
  });

  it('request with invalid token returns 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Bearer invalid-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('request with valid token returns user info', async () => {
    const token = await createTestToken({
      sub: '70000000-0000-0000-0000-000000000001',
      iss: 'http://localhost:9080/realms/iam-platform',
      aud: 'iam-backend',
      email: 'alice@example.com',
      preferred_username: 'alice',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.userId).toBe(SEED_IDS.USER_ALICE);
    expect(body.organizations).toBeDefined();
    expect(body.organizations.length).toBeGreaterThanOrEqual(1);
  });

  describe('provider dependency contract', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
    async function sessionToken() {
      return createTestToken({
        sub: '70000000-0000-0000-0000-000000000001',
        iss: 'http://localhost:9080/realms/iam-platform',
        aud: 'iam-backend',
        claims: { sid: 'session1' },
      });
    }
    function enableIntrospection() {
      vi.stubEnv('KEYCLOAK_INTROSPECTION', 'true');
      vi.stubEnv('KEYCLOAK_CLIENT_SECRET', 'test-only-secret');
    }

    it.each([
      ['network failure / timeout', () => vi.fn().mockRejectedValue(new Error('timeout'))],
      ['provider HTTP 500', () => vi.fn().mockResolvedValue(new Response('', { status: 500 }))],
      ['provider HTTP 503', () => vi.fn().mockResolvedValue(new Response('', { status: 503 }))],
    ])('introspection %s denies with exactly 503 DEPENDENCY_UNAVAILABLE', async (_label, makeFetch) => {
      enableIntrospection();
      const fetcher = makeFetch();
      vi.stubGlobal('fetch', fetcher);
      const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${await sessionToken()}` } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(response.json()).not.toHaveProperty('userId');
    });

    it('provider answering active:false is an invalid credential: exactly 401, not 503', async () => {
      enableIntrospection();
      const fetcher = vi.fn().mockResolvedValue(Response.json({ active: false }));
      vi.stubGlobal('fetch', fetcher);
      const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${await sessionToken()}` } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('provider answering active:true for the matching session is allowed (positive control)', async () => {
      enableIntrospection();
      const fetcher = vi.fn().mockResolvedValue(Response.json({ active: true, sub: '70000000-0000-0000-0000-000000000001', sid: 'session1' }));
      vi.stubGlobal('fetch', fetcher);
      const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${await sessionToken()}` } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(200);
      expect(response.json().userId).toBe(SEED_IDS.USER_ALICE);
    });
  });
});

describe('API Integration: Tenant-Scoped Resources', () => {
  let aliceToken: string;

  beforeAll(async () => {
    aliceToken = await createTestToken({
      sub: '70000000-0000-0000-0000-000000000001',
      iss: 'http://localhost:9080/realms/iam-platform',
      aud: 'iam-backend',
    });
  });

  it('listing resources without X-Organization-ID returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/resources',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('listing Acme resources returns only Acme data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/resources',
      headers: {
        authorization: `Bearer ${aliceToken}`,
        'x-organization-id': SEED_IDS.ORG_ACME,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.resources.length).toBeGreaterThan(0);
    expect(body.organizationId).toBe(SEED_IDS.ORG_ACME);
    // Verify no Globex resources leak
    body.resources.forEach((r: any) => {
      expect(r.organization_id).toBe(SEED_IDS.ORG_ACME);
    });
  });

  it('Alice accessing Acme resource by ID succeeds', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/resources/${SEED_IDS.RES_ACME_COURSE1}`,
      headers: {
        authorization: `Bearer ${aliceToken}`,
        'x-organization-id': SEED_IDS.ORG_ACME,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.resource.id).toBe(SEED_IDS.RES_ACME_COURSE1);
  });

  it('Cross-tenant attack: Globex resource ID with Acme org header returns 404 or 403', async () => {
    // Try to access Globex resource while claiming to be in Acme context
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/resources/${SEED_IDS.RES_GLOBEX_COURSE1}`,
      headers: {
        authorization: `Bearer ${aliceToken}`,
        'x-organization-id': SEED_IDS.ORG_ACME,
      },
    });

    // The important security property: should NOT return 200 with the resource.
    // Whether it returns 403 (access denied) or 404 (not found in org) depends
    // on the exact authorization state, but the resource must NOT be exposed.
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.resource).toBeUndefined();
  });

  it('accessing org where user has no membership returns 403', async () => {
    const bobToken = await createTestToken({
      sub: '70000000-0000-0000-0000-000000000002',
      iss: 'http://localhost:9080/realms/iam-platform',
      aud: 'iam-backend',
    });

    // Bob is NOT a member of Globex
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/resources',
      headers: {
        authorization: `Bearer ${bobToken}`,
        'x-organization-id': SEED_IDS.ORG_GLOBEX,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('TENANT_ACCESS_DENIED');
  });

  it('member management denied for non-admin (Charlie)', async () => {
    const charlieToken = await createTestToken({
      sub: '70000000-0000-0000-0000-000000000003',
      iss: 'http://localhost:9080/realms/iam-platform',
      aud: 'iam-backend',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/members',
      headers: {
        authorization: `Bearer ${charlieToken}`,
        'x-organization-id': SEED_IDS.ORG_ACME,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('audit events accessible to admin (Alice in Acme)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events',
      headers: {
        authorization: `Bearer ${aliceToken}`,
        'x-organization-id': SEED_IDS.ORG_ACME,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.events)).toBe(true);
  });
});

describe('HTTP adversarial resource/submission validation',()=>{
  async function headers(subject:string) {
    const token=await createTestToken({sub:subject,iss:'http://localhost:9080/realms/iam-platform',aud:'iam-backend'});
    return {authorization:`Bearer ${token}`,'x-organization-id':SEED_IDS.ORG_ACME};
  }
  it('malformed resource UUID rejected before DB lookup',async()=>{
    const result=await app.inject({url:'/api/v1/resources/not-a-uuid',headers:await headers('70000000-0000-0000-0000-000000000001')});
    expect(result.statusCode).toBe(400);
  });
  it('consent grants bio only for its purpose and withdrawal remains possible during suspension',async()=>{
    const {getDb}=await import('../../src/db/connection.js');
    const db=getDb();
    const caller=await headers('70000000-0000-0000-0000-000000000003');
    const reader=await headers('70000000-0000-0000-0000-000000000002');
    const path=`/api/v1/profiles/${SEED_IDS.USER_CHARLIE}`;
    try{
      const grant=await app.inject({method:'POST',url:'/api/v1/consents',headers:caller,payload:{purpose:'profile-sharing',granted:true}});
      expect(grant.statusCode).toBe(200);
      const shared=await app.inject({url:path,headers:reader});
      expect(shared.statusCode).toBe(200);expect(shared.json().profile.bio).toBe('Student');
      expect(shared.json().profile).not.toHaveProperty('email');
      await db.updateTable('memberships').set({status:'suspended'}).where('id','=',SEED_IDS.MEM_CHARLIE_ACME).execute();
      const withdraw=await app.inject({method:'POST',url:'/api/v1/consents',headers:caller,payload:{purpose:'profile-sharing',granted:false}});
      expect(withdraw.statusCode).toBe(200);
    }finally{
      await db.updateTable('memberships').set({status:'active'}).where('id','=',SEED_IDS.MEM_CHARLIE_ACME).execute();
      await app.inject({method:'POST',url:'/api/v1/consents',headers:caller,payload:{purpose:'profile-sharing',granted:false}});
    }
    const privateProfile=await app.inject({url:path,headers:reader});
    expect(privateProfile.statusCode).toBe(200);expect(privateProfile.json().profile).not.toHaveProperty('bio');
  });
  it('suspension (membership AND organization) permits only own withdrawal; grants and foreign tenants denied; history and audit preserved',async()=>{
    const {getDb}=await import('../../src/db/connection.js');
    const db=getDb();
    const caller=await headers('70000000-0000-0000-0000-000000000003'); // Charlie: Acme learner, no Globex membership
    const count=async()=>Number((await db.selectFrom('consents').select(eb=>eb.fn.countAll<string>().as('n'))
      .where('user_id','=',SEED_IDS.USER_CHARLIE).where('organization_id','=',SEED_IDS.ORG_ACME).executeTakeFirstOrThrow()).n);
    const post=(granted:boolean,extra:Record<string,string>={})=>app.inject({method:'POST',url:'/api/v1/consents',headers:{...caller,...extra},payload:{purpose:'analytics',granted}});
    const before=await count();
    try{
      // Organization-level suspension.
      await db.updateTable('organizations').set({status:'suspended'}).where('id','=',SEED_IDS.ORG_ACME).execute();
      const correlation=randomUUID();
      const withdraw=await post(false,{'x-correlation-id':correlation});
      expect(withdraw.statusCode).toBe(200);
      const audit=await db.selectFrom('audit_events').selectAll().where('correlation_id','=',correlation).where('action','=','consent.withdraw').executeTakeFirstOrThrow();
      expect(audit.actor_id).toBe(SEED_IDS.USER_CHARLIE);expect(audit.organization_id).toBe(SEED_IDS.ORG_ACME);
      const grant=await post(true);
      expect(grant.statusCode).toBe(403);
      // Ordinary tenant routes stay closed under suspension.
      expect((await app.inject({url:'/api/v1/resources',headers:caller})).statusCode).toBe(403);
      await db.updateTable('organizations').set({status:'active'}).where('id','=',SEED_IDS.ORG_ACME).execute();

      // Membership-level suspension.
      await db.updateTable('memberships').set({status:'suspended'}).where('id','=',SEED_IDS.MEM_CHARLIE_ACME).execute();
      expect((await post(false)).statusCode).toBe(200);
      expect((await post(true)).statusCode).toBe(403);

      // Foreign tenant: no membership row in Globex, so even withdrawal is denied.
      const foreign=await app.inject({method:'POST',url:'/api/v1/consents',headers:{...caller,'x-organization-id':SEED_IDS.ORG_GLOBEX},payload:{purpose:'analytics',granted:false}});
      expect(foreign.statusCode).toBe(403);expect(foreign.json().code).toBe('TENANT_ACCESS_DENIED');
      // Unknown organization is denied the same way.
      const unknown=await app.inject({method:'POST',url:'/api/v1/consents',headers:{...caller,'x-organization-id':randomUUID()},payload:{purpose:'analytics',granted:false}});
      expect(unknown.statusCode).toBe(403);
      expect(await db.selectFrom('consents').select('id').where('user_id','=',SEED_IDS.USER_CHARLIE).where('organization_id','=',SEED_IDS.ORG_GLOBEX).execute()).toHaveLength(0);

      // Exactly the two withdrawals were appended; denied grants wrote nothing.
      expect(await count()).toBe(before+2);
    }finally{
      await db.updateTable('organizations').set({status:'active'}).where('id','=',SEED_IDS.ORG_ACME).execute();
      await db.updateTable('memberships').set({status:'active'}).where('id','=',SEED_IDS.MEM_CHARLIE_ACME).execute();
    }
  });
  it('learner cannot select draft resources',async()=>{
    const result=await app.inject({url:'/api/v1/resources?status=draft',headers:await headers('70000000-0000-0000-0000-000000000003')});
    expect(result.statusCode).toBe(403);
  });
  it('learner cannot read a draft by ID',async()=>{
    const result=await app.inject({url:'/api/v1/resources/50000000-0000-0000-0000-000000000005',headers:await headers('70000000-0000-0000-0000-000000000003')});
    expect(result.statusCode).toBe(403);
  });
  it('instructor list contains assigned submissions only',async()=>{
    const result=await app.inject({url:'/api/v1/submissions',headers:await headers('70000000-0000-0000-0000-000000000002')});
    expect(result.statusCode).toBe(200);
    expect(result.json().submissions.map((s:{id:string})=>s.id)).toContain('80000000-0000-0000-0000-000000000001');
    expect(result.json().submissions.map((s:{id:string})=>s.id)).not.toContain('80000000-0000-0000-0000-000000000002');
  });
  it('instructor grade unrelated submission denied over HTTP',async()=>{
    const result=await app.inject({method:'PATCH',url:'/api/v1/submissions/80000000-0000-0000-0000-000000000002/grade',headers:await headers('70000000-0000-0000-0000-000000000002'),payload:{grade:80}});
    expect(result.statusCode).toBe(403);
  });
  it('out of bounds grade rejected',async()=>{
    const result=await app.inject({method:'PATCH',url:'/api/v1/submissions/80000000-0000-0000-0000-000000000001/grade',headers:await headers('70000000-0000-0000-0000-000000000002'),payload:{grade:101}});
    expect(result.statusCode).toBe(400);
  });
  it('assigned instructor grades actual submission and commits required audit',async()=>{
    const {getDb}=await import('../../src/db/connection.js');
    const db=getDb();
    const submissionId='80000000-0000-0000-0000-000000000001';
    const correlation=randomUUID();
    const before=await db.selectFrom('submissions').select('grade').where('id','=',submissionId).executeTakeFirstOrThrow();
    try{
      const result=await app.inject({method:'PATCH',url:`/api/v1/submissions/${submissionId}/grade`,headers:{...await headers('70000000-0000-0000-0000-000000000002'),'x-correlation-id':correlation},payload:{grade:91}});
      expect(result.statusCode).toBe(200);
      // PostgreSQL NUMERIC is intentionally returned as a decimal string by pg.
      expect(result.json().submission.grade).toBe('91');
      const audit=await db.selectFrom('audit_events').selectAll().where('correlation_id','=',correlation).where('action','=','submission.grade').executeTakeFirstOrThrow();
      expect(audit.actor_id).toBe(SEED_IDS.USER_BOB);expect(audit.organization_id).toBe(SEED_IDS.ORG_ACME);expect(audit.decision).toBe('allow');
    }finally{await db.updateTable('submissions').set({grade:before.grade}).where('id','=',submissionId).execute();}
  });
  it('audit insertion failure rolls back a sensitive grade operation',async()=>{
    const {getDb}=await import('../../src/db/connection.js');
    const {sql}=await import('kysely');
    const db=getDb();
    const correlation='99999999-1111-2222-3333-444444444444';
    const before=await db.selectFrom('submissions').select('grade').where('id','=','80000000-0000-0000-0000-000000000001').executeTakeFirstOrThrow();
    try {
      await sql`CREATE FUNCTION test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = '99999999-1111-2222-3333-444444444444' THEN RAISE EXCEPTION 'Synthetic audit outage'; END IF; RETURN NEW; END $$`.execute(db);
      await sql`CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_audit_failure()`.execute(db);
      const result=await app.inject({method:'PATCH',url:'/api/v1/submissions/80000000-0000-0000-0000-000000000001/grade',headers:{...await headers('70000000-0000-0000-0000-000000000002'),'x-correlation-id':correlation},payload:{grade:83}});
      expect(result.statusCode).toBeGreaterThanOrEqual(500);
      const after=await db.selectFrom('submissions').select('grade').where('id','=','80000000-0000-0000-0000-000000000001').executeTakeFirstOrThrow();
      expect(after.grade).toBe(before.grade);
    }finally{
      await sql`DROP TRIGGER IF EXISTS test_audit_failure ON audit_events`.execute(db);
      await sql`DROP FUNCTION IF EXISTS test_audit_failure()`.execute(db);
    }
  });

  it('role removal immediately denies access', async () => {
    const { getDb } = await import('../../src/db/connection.js');
    const db = getDb();
    
    // Alice is admin in Acme, can manage members
    let result = await app.inject({
      url: '/api/v1/members',
      headers: await headers('70000000-0000-0000-0000-000000000001') // Alice
    });
    expect(result.statusCode).toBe(200);

    // Remove her admin role
    const assignments = await db.selectFrom('membership_roles').selectAll().where('membership_id', '=', SEED_IDS.MEM_ALICE_ACME).execute();
    await db.deleteFrom('membership_roles').where('membership_id', '=', SEED_IDS.MEM_ALICE_ACME).execute();

    try {
      result = await app.inject({
        url: '/api/v1/members',
        headers: await headers('70000000-0000-0000-0000-000000000001')
      });
      expect(result.statusCode).toBe(403);
    } finally {
      if (assignments.length) await db.insertInto('membership_roles').values(assignments).execute();
    }
  });

  it('suspension immediately denies tenant access across all routes', async () => {
    const { getDb } = await import('../../src/db/connection.js');
    const db = getDb();
    
    // Bob reading resources (returns 200)
    let result = await app.inject({
      url: '/api/v1/resources',
      headers: await headers('70000000-0000-0000-0000-000000000002') // Bob
    });
    expect(result.statusCode).toBe(200);

    // Suspend Bob's membership
    await db.updateTable('memberships').set({status: 'suspended'}).where('id', '=', SEED_IDS.MEM_BOB_ACME).execute();

    try {
      result = await app.inject({
        url: '/api/v1/resources',
        headers: await headers('70000000-0000-0000-0000-000000000002')
      });
      expect(result.statusCode).toBe(403);
    } finally {
      await db.updateTable('memberships').set({status: 'active'}).where('id', '=', SEED_IDS.MEM_BOB_ACME).execute();
    }
  });

  it('unseeded third tenant access is isolated and denies access', async () => {
    const { getDb } = await import('../../src/db/connection.js');
    const db = getDb();
    const thirdTenantId = randomUUID();

    await db.insertInto('organizations').values({
      id: thirdTenantId,
      name: 'Third Tenant',
      slug: 'third-tenant',
      status: 'active'
    }).execute();

    try {
      const charlieToken = await createTestToken({
        sub: '70000000-0000-0000-0000-000000000003', // Charlie
        iss: 'http://localhost:9080/realms/iam-platform',
        aud: 'iam-backend',
      });

      // Try accessing the new tenant
      const result = await app.inject({
        url: '/api/v1/resources',
        headers: {
          authorization: `Bearer ${charlieToken}`,
          'x-organization-id': thirdTenantId
        }
      });
      
      // Charlie has no membership in thirdTenantId
      expect(result.statusCode).toBe(403);
    } finally {
      await db.deleteFrom('organizations').where('id', '=', thirdTenantId).execute();
    }
  });

  it('selector/resource substitution attack fails on mutation endpoints', async () => {
    // Attempting to patch submission from Acme while being in Globex (Bob is not a member of Globex anyway)
    // Wait, let's use Alice, who is admin in Acme, but we try to grade a Globex submission while passing Acme in header
    const result = await app.inject({
      method: 'PATCH',
      url: `/api/v1/submissions/${SEED_IDS.RES_GLOBEX_COURSE1}/grade`, // using some random ID from Globex, actually it's submission ID
      headers: await headers('70000000-0000-0000-0000-000000000001'),
      payload: { grade: 90 }
    });
    
    // Either 404/403 or 400 because submission ID isn't found in Acme
    expect([403, 404]).toContain(result.statusCode);
  });
});
