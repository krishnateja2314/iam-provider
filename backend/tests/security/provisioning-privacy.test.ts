import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { getDb, closeDb } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { createMember, provisionOrganization, setOrganizationStatus } from '../../src/modules/provisioning/provisioning-service.js';
import { getSharedProfile, recordConsent } from '../../src/modules/user/privacy-service.js';

describe('real PostgreSQL provisioning and privacy boundaries', () => {
  const prefix = `privacy-${randomUUID()}`;
  const users = Array.from({ length: 5 }, () => randomUUID());
  const context = () => ({ actorUserId: users[0], correlationId: randomUUID() });
  const request = (suffix: string, extra = {}) => ({ ...context(), name: 'Synthetic privacy fixture',
    slug: `${prefix}-${suffix}`, adminUserId: users[0], idempotencyKey: `${prefix}-${suffix}`, ...extra });
  const db = getDb();

  beforeAll(async () => {
    await migrate();
    await db.insertInto('users').values(users.map(id => ({ id, display_name: 'Synthetic privacy test' }))).execute();
  });

  afterAll(async () => {
    // Delete only the synthetic fixtures, never truncate or reseed shared data.
    await db.deleteFrom('organizations').where('slug', 'like', `${prefix}%`).execute();
    await db.deleteFrom('audit_events').where('actor_id', 'in', users).execute();
    await db.deleteFrom('users').where('id', 'in', users).execute();
    await closeDb();
  });

  it('records migration versions and preserves data on concurrent repeat runs', async () => {
    await Promise.all([migrate(), migrate()]);
    const ledger = await sql<{ version: number }>`select version from schema_migrations order by version`.execute(db);
    expect(ledger.rows.map(row => row.version)).toEqual(expect.arrayContaining([1, 2]));
    expect(await db.selectFrom('users').select('id').where('id', 'in', users).execute()).toHaveLength(users.length);
  });

  it('serializes concurrent retries and detects changed payload without partial effects', async () => {
    const input = request('retries');
    const results = await Promise.all(Array.from({ length: 6 }, () => provisionOrganization(input)));
    expect(new Set(results.map(r => r.organizationId)).size).toBe(1);
    const orgId = results[0].organizationId;
    expect(await db.selectFrom('roles').select('id').where('organization_id', '=', orgId).execute()).toHaveLength(3);
    expect(await db.selectFrom('audit_events').select('id').where('organization_id', '=', orgId).execute()).toHaveLength(1);
    await expect(provisionOrganization({ ...input, name: 'Changed payload' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await db.selectFrom('organizations').select('name').where('id', '=', orgId).executeTakeFirst()).toMatchObject({ name: input.name });
    await expect(provisionOrganization({ ...input, actorUserId: users[1] })).rejects.toMatchObject({ code: '23505' });
    expect(await db.selectFrom('provisioning_requests').selectAll().where('actor_id', '=', users[1]).execute()).toHaveLength(0);
    const otherActor = await provisionOrganization({ ...input, actorUserId: users[1], slug: `${prefix}-other-actor` });
    expect(otherActor.organizationId).not.toBe(orgId);
  });

  it('rolls back organization, bootstrap and ledger when audit insertion fails', async () => {
    const input = request('rollback', { correlationId: 'not-a-uuid' });
    await expect(provisionOrganization(input)).rejects.toMatchObject({ code: '22P02' });
    expect(await db.selectFrom('organizations').select('id').where('slug', '=', input.slug).execute()).toHaveLength(0);
    expect(await db.selectFrom('provisioning_requests').selectAll().where('idempotency_key', '=', input.idempotencyKey).execute()).toHaveLength(0);
    await expect(provisionOrganization({ ...input, correlationId: randomUUID() })).resolves.toHaveProperty('organizationId');
  });

  it('locks member quotas across concurrent creation and rolls back failed mutation audit', async () => {
    const org = await provisionOrganization(request('members', { maxMembers: 2 }));
    await expect(createMember({ ...context(), organizationId: org.organizationId, userId: users[1], correlationId: 'bad' }))
      .rejects.toMatchObject({ code: '22P02' });
    const outcomes = await Promise.allSettled([users[1], users[2]].map(userId => createMember({ ...context(), organizationId: org.organizationId, userId })));
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);
    expect(await db.selectFrom('memberships').select('id').where('organization_id', '=', org.organizationId).execute()).toHaveLength(2);
    expect(await db.selectFrom('profiles').select('id').where('organization_id', '=', org.organizationId).execute()).toHaveLength(2);
  });

  it('enforces resource quotas even through direct concurrent SQL', async () => {
    const org = await provisionOrganization(request('resources', { maxResources: 1 }));
    const results = await Promise.allSettled([1, 2].map(i => db.insertInto('learning_resources').values({
      organization_id: org.organizationId, title: `Synthetic ${i}`, description: null, resource_type: 'course', status: 'draft', created_by: users[0],
    }).execute()));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.selectFrom('learning_resources').select('id').where('organization_id', '=', org.organizationId).execute()).toHaveLength(1);
  });

  it('protects membership role child and parent organization updates', async () => {
    const a = await provisionOrganization(request('roles-a'));
    const b = await provisionOrganization(request('roles-b'));
    const roleA = await db.selectFrom('roles').select('id').where('organization_id', '=', a.organizationId).where('name', '=', 'admin').executeTakeFirstOrThrow();
    const roleB = await db.selectFrom('roles').select('id').where('organization_id', '=', b.organizationId).where('name', '=', 'learner').executeTakeFirstOrThrow();
    await expect(db.insertInto('membership_roles').values({ membership_id: a.membershipId, role_id: roleB.id, organization_id: a.organizationId }).execute()).rejects.toMatchObject({ code: '23503' });
    await expect(db.updateTable('roles').set({ organization_id: b.organizationId, name: 'moved-admin' }).where('id', '=', roleA.id).execute()).rejects.toMatchObject({ code: '23503' });
    await expect(db.updateTable('memberships').set({ organization_id: b.organizationId, user_id: users[4] }).where('id', '=', a.membershipId).execute()).rejects.toMatchObject({ code: '23503' });
  });

  it('binds teaching and submissions to membership and resource tenant including parent updates', async () => {
    const a = await provisionOrganization(request('teaching-a'));
    const b = await provisionOrganization(request('teaching-b'));
    const course = await db.insertInto('learning_resources').values({ organization_id: a.organizationId,
      title: 'Synthetic course', description: null, resource_type: 'course', status: 'draft', created_by: users[0] }).returning('id').executeTakeFirstOrThrow();
    await expect(db.insertInto('teaching_assignments').values({ user_id: users[4], organization_id: a.organizationId, resource_id: course.id, role: 'instructor' }).execute()).rejects.toMatchObject({ code: '23503' });
    await db.insertInto('teaching_assignments').values({ user_id: users[0], organization_id: a.organizationId, resource_id: course.id, role: 'instructor' }).execute();
    await db.insertInto('submissions').values({ user_id: users[0], organization_id: a.organizationId, course_id: course.id, grade: 80 }).execute();
    await expect(db.insertInto('submissions').values({ user_id: users[0], organization_id: b.organizationId, course_id: course.id, grade: null }).execute()).rejects.toMatchObject({ code: '23503' });
    await expect(db.insertInto('submissions').values({ user_id: users[4], organization_id: a.organizationId, course_id: course.id, grade: null }).execute()).rejects.toMatchObject({ code: '23503' });
    await expect(db.updateTable('learning_resources').set({ organization_id: b.organizationId }).where('id', '=', course.id).execute()).rejects.toMatchObject({ code: '23503' });
    await expect(db.updateTable('memberships').set({ user_id: users[4] }).where('id', '=', a.membershipId).execute()).rejects.toMatchObject({ code: '23503' });
    await expect(db.updateTable('submissions').set({ grade: 101 }).where('course_id', '=', course.id).execute()).rejects.toMatchObject({ code: '23514' });
  });

  it('appends purpose-scoped grant/withdrawal and filters profile fields by current consent', async () => {
    const org = await provisionOrganization(request('consent'));
    await createMember({ ...context(), organizationId: org.organizationId, userId: users[1] });
    await db.updateTable('profiles').set({ bio: 'Synthetic biography' }).where('user_id', '=', users[0]).where('organization_id', '=', org.organizationId).execute();
    const query = { actorUserId: users[1], userId: users[0], organizationId: org.organizationId,
      fields: ['userId', 'displayName', 'bio', 'email', 'provider_metadata', 'organization_id'] };
    const consent = { ...context(), organizationId: org.organizationId, purpose: 'profile-sharing' as const };
    expect(await getSharedProfile(query)).not.toHaveProperty('bio');
    await expect(getSharedProfile({ ...query, actorUserId: users[4] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(recordConsent({ ...consent, correlationId: 'bad', granted: true })).rejects.toMatchObject({ code: '22P02' });
    expect(await db.selectFrom('consents').select('id').where('organization_id', '=', org.organizationId).execute()).toHaveLength(0);
    await recordConsent({ ...consent, purpose: 'analytics', granted: true });
    expect(await getSharedProfile(query)).not.toHaveProperty('bio');
    const grant = await recordConsent({ ...consent, granted: true });
    expect(await getSharedProfile(query)).toEqual({ userId: users[0], displayName: 'Synthetic privacy test', bio: 'Synthetic biography' });
    await expect(db.updateTable('consents').set({ granted: false }).where('id', '=', grant.consentId).execute()).rejects.toThrow('append-only');
    await expect(db.deleteFrom('consents').where('id', '=', grant.consentId).execute()).rejects.toThrow('append-only');
    await recordConsent({ ...consent, granted: false });
    expect(await getSharedProfile(query)).not.toHaveProperty('bio');
    await recordConsent({ ...consent, granted: true });
    expect(await getSharedProfile(query)).toHaveProperty('bio');
    await db.updateTable('memberships').set({ status: 'suspended' }).where('user_id', '=', users[0]).where('organization_id', '=', org.organizationId).execute();
    await expect(getSharedProfile(query)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(recordConsent({ ...consent, granted: false })).resolves.toHaveProperty('consentId');
    await expect(recordConsent({ ...consent, granted: true })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('suspends/reactivates with audit and rejects member mutation during suspension', async () => {
    const org = await provisionOrganization(request('suspension'));
    await setOrganizationStatus({ ...context(), organizationId: org.organizationId, status: 'suspended' });
    await expect(createMember({ ...context(), organizationId: org.organizationId, userId: users[1] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(recordConsent({ ...context(), organizationId: org.organizationId, purpose: 'analytics', granted: true })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(recordConsent({ ...context(), organizationId: org.organizationId, purpose: 'analytics', granted: false })).resolves.toHaveProperty('consentId');
    await expect(setOrganizationStatus({ actorUserId: users[2], correlationId: randomUUID(), organizationId: org.organizationId, status: 'active' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setOrganizationStatus({ ...context(), correlationId: 'bad', organizationId: org.organizationId, status: 'active' })).rejects.toMatchObject({ code: '22P02' });
    expect(await db.selectFrom('organizations').select('status').where('id', '=', org.organizationId).executeTakeFirst()).toMatchObject({ status: 'suspended' });
    await setOrganizationStatus({ ...context(), organizationId: org.organizationId, status: 'active' });
    await expect(setOrganizationStatus({ actorUserId: users[2], correlationId: randomUUID(), organizationId: org.organizationId,
      status: 'active', platformAuthorized: true })).resolves.toMatchObject({ status: 'active' });
    await expect(createMember({ ...context(), organizationId: org.organizationId, userId: users[1] })).resolves.toHaveProperty('membershipId');
    const events = await db.selectFrom('audit_events').select('action').where('organization_id', '=', org.organizationId).execute();
    expect(events.map(e => e.action)).toEqual(expect.arrayContaining(['organization.suspend', 'organization.reactivate', 'membership.create']));
  });
});
