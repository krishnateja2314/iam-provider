// ============================================================
// Integration Test: Full API flow with HTTP requests
// ============================================================
// Tests the actual Fastify server endpoints with simulated
// authenticated requests. Uses the test JWT infrastructure.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
});
