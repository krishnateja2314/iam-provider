// ============================================================
// Security Test Suite: Audit Events (T10)
// ============================================================
// T10: Allowed and denied requests produce audit fields;
//      authorization failure never grants access (fail-closed)
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { recordAuditEvent, queryAuditEvents } from '../../src/modules/audit/audit-service.js';
import { authorize } from '../../src/modules/authorization/authorization-engine.js';
import { closeDb } from '../../src/db/connection.js';
import { SEED_IDS } from '../helpers.js';
import { v4 as uuidv4 } from 'uuid';
import type { AuthorizationRequest, AuthenticatedUser } from '../../src/common/types.js';

function makeSubject(userId: string): AuthenticatedUser {
  return {
    userId,
    keycloakSub: 'test-sub',
    issuer: 'http://localhost:8180/realms/iam-platform',
  };
}

afterAll(async () => {
  await closeDb();
});

describe('T10: Audit event generation', () => {
  it('real unavailable authorization storage fails closed', async () => {
    const original = process.env.DATABASE_URL;
    await closeDb();
    try {
      process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:19/unavailable';
      const decision = await authorize({subject:makeSubject(SEED_IDS.USER_ALICE),organization:SEED_IDS.ORG_ACME,resource:'learning-resource',action:'read'});
      expect(decision.allowed).toBe(false);
      expect(decision.policy).toBe('error-failclosed');
    } finally {
      await closeDb();
      process.env.DATABASE_URL = original;
    }
  });
  it('records an allow audit event with required fields', async () => {
    const correlationId = uuidv4();

    const eventId = await recordAuditEvent({
      actorId: SEED_IDS.USER_ALICE,
      actorType: 'user',
      organizationId: SEED_IDS.ORG_ACME,
      action: 'resource.read',
      resourceType: 'learning-resource',
      resourceId: SEED_IDS.RES_ACME_COURSE1,
      decision: 'allow',
      reason: 'Admin role grants access',
      correlationId,
      ipAddress: '127.0.0.1',
    });

    expect(eventId).toBeDefined();

    const events = await queryAuditEvents({
      correlationId,
      organizationId: SEED_IDS.ORG_ACME,
    });

    expect(events.length).toBeGreaterThan(0);
    const event = events[0];
    expect(event.actor_id).toBe(SEED_IDS.USER_ALICE);
    expect(event.organization_id).toBe(SEED_IDS.ORG_ACME);
    expect(event.action).toBe('resource.read');
    expect(event.decision).toBe('allow');
    expect(event.correlation_id).toBe(correlationId);
    expect(event.resource_type).toBe('learning-resource');
    expect(event.resource_id).toBe(SEED_IDS.RES_ACME_COURSE1);
    expect(event.timestamp).toBeDefined();
  });

  it('records a deny audit event with required fields', async () => {
    const correlationId = uuidv4();

    await recordAuditEvent({
      actorId: SEED_IDS.USER_CHARLIE,
      actorType: 'user',
      organizationId: SEED_IDS.ORG_ACME,
      action: 'member.manage',
      resourceType: 'member',
      resourceId: null,
      decision: 'deny',
      reason: 'Only admins can manage members',
      correlationId,
      ipAddress: '192.168.1.100',
    });

    const events = await queryAuditEvents({
      correlationId,
      decision: 'deny',
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].decision).toBe('deny');
    expect(events[0].reason).toBe('Only admins can manage members');
  });

  it('audit events are queryable by organization', async () => {
    const correlationId = uuidv4();

    // Record event for Acme
    await recordAuditEvent({
      actorId: SEED_IDS.USER_ALICE,
      actorType: 'user',
      organizationId: SEED_IDS.ORG_ACME,
      action: 'test.org-filter',
      resourceType: null,
      resourceId: null,
      decision: 'allow',
      reason: 'test',
      correlationId,
      ipAddress: '127.0.0.1',
    });

    // Record event for Globex
    await recordAuditEvent({
      actorId: SEED_IDS.USER_DIANA,
      actorType: 'user',
      organizationId: SEED_IDS.ORG_GLOBEX,
      action: 'test.org-filter',
      resourceType: null,
      resourceId: null,
      decision: 'allow',
      reason: 'test',
      correlationId,
      ipAddress: '127.0.0.1',
    });

    // Query by Acme only
    const acmeEvents = await queryAuditEvents({
      organizationId: SEED_IDS.ORG_ACME,
      action: 'test.org-filter',
    });

    // Acme events should not contain Globex events
    const orgIds = acmeEvents.map(e => e.organization_id);
    expect(orgIds.every(id => id === SEED_IDS.ORG_ACME)).toBe(true);
  });

  it('audit does not store raw tokens or passwords', async () => {
    const correlationId = uuidv4();

    await recordAuditEvent({
      actorId: SEED_IDS.USER_ALICE,
      actorType: 'user',
      organizationId: SEED_IDS.ORG_ACME,
      action: 'authentication',
      resourceType: null,
      resourceId: null,
      decision: 'allow',
      reason: 'Valid token',
      correlationId,
      ipAddress: '127.0.0.1',
      metadata: { method: 'bearer-token' }, // No actual token stored
    });

    const events = await queryAuditEvents({ correlationId });
    expect(events.length).toBeGreaterThan(0);
    const event = events[0];

    // Verify no token/password fields exist
    const eventStr = JSON.stringify(event);
    expect(eventStr).not.toContain('eyJ'); // JWT prefix
    expect(eventStr).not.toContain('password');
    expect(eventStr).not.toContain('secret');
  });

  it('authorization failure results in fail-closed (deny)', async () => {
    // Test with a non-existent user to trigger error path
    const request: AuthorizationRequest = {
      subject: {
        userId: '99999999-9999-9999-9999-999999999999',
        keycloakSub: 'nonexistent',
        issuer: 'http://localhost:8180/realms/iam-platform',
      },
      organization: SEED_IDS.ORG_ACME,
      resource: 'learning-resource',
      action: 'read',
    };

    const decision = await authorize(request);
    // Non-member should be denied (fail-closed)
    expect(decision.allowed).toBe(false);
  });
});
