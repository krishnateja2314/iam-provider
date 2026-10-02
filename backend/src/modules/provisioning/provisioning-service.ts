import { createHash } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { getDb } from '../../db/connection.js';
import type { Database } from '../../db/schema.js';

export class ProvisioningError extends Error {
  constructor(public readonly code: 'conflict' | 'quota_exceeded' | 'forbidden' | 'invalid_input' | 'not_found', message: string) {
    super(message);
  }
}

export interface MutationContext { actorUserId: string; correlationId: string }
export interface ProvisionOrgRequest extends MutationContext {
  name: string;
  slug: string;
  adminUserId: string;
  idempotencyKey: string;
  maxMembers?: number;
  maxResources?: number;
}

export async function auditMutation(trx: Transaction<Database>, context: MutationContext, organizationId: string,
  action: string, resourceType: string, resourceId: string, subjectId?: string): Promise<void> {
  await trx.insertInto('audit_events').values({
    actor_id: context.actorUserId, actor_type: 'user', organization_id: organizationId,
    action, resource_type: resourceType, resource_id: resourceId, subject_id: subjectId ?? null,
    decision: 'allow', correlation_id: context.correlationId,
    reason: null, ip_address: null, metadata: null,
  }).execute();
}

export async function lockOrganization(trx: Transaction<Database>, organizationId: string) {
  const org = await trx.selectFrom('organizations').selectAll().where('id', '=', organizationId).forUpdate().executeTakeFirst();
  if (!org) throw new ProvisioningError('not_found', 'Organization not found');
  return org;
}

export async function requireOrganizationAdmin(trx: Transaction<Database>, actorUserId: string, organizationId: string) {
  const member = await trx.selectFrom('memberships as m')
    .innerJoin('membership_roles as mr', 'mr.membership_id', 'm.id')
    .innerJoin('roles as r', 'r.id', 'mr.role_id')
    .select('m.id').where('m.user_id', '=', actorUserId).where('m.organization_id', '=', organizationId)
    .where('m.status', '=', 'active').where('r.name', '=', 'admin').executeTakeFirst();
  if (!member) throw new ProvisioningError('forbidden', 'Active organization administrator required');
}

export async function provisionOrganization(request: ProvisionOrgRequest): Promise<{
  organizationId: string; membershipId: string; roles: string[];
}> {
  const maxMembers = request.maxMembers ?? 1000;
  const maxResources = request.maxResources ?? 1000;
  if (!request.name.trim() || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(request.slug) ||
      !request.idempotencyKey || request.idempotencyKey.length > 200 ||
      !Number.isSafeInteger(maxMembers) || maxMembers < 1 || !Number.isSafeInteger(maxResources) || maxResources < 1) {
    throw new ProvisioningError('invalid_input', 'Invalid organization provisioning input');
  }
  const hash = createHash('sha256').update(JSON.stringify({ name: request.name, slug: request.slug,
    adminUserId: request.adminUserId, maxMembers, maxResources })).digest('hex');
  return getDb().transaction().execute(async trx => {
    // A transaction lock serializes concurrent retries before either has a ledger row.
    await sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([request.actorUserId, request.idempotencyKey])}, 0))`.execute(trx);
    const prior = await trx.selectFrom('provisioning_requests').selectAll()
      .where('actor_id', '=', request.actorUserId).where('idempotency_key', '=', request.idempotencyKey).executeTakeFirst();
    if (prior) {
      if (prior.payload_hash !== hash) throw new ProvisioningError('conflict', 'Idempotency key payload conflict');
      return { organizationId: prior.organization_id, membershipId: prior.membership_id, roles: ['admin'] };
    }
    const org = await trx.insertInto('organizations').values({ name: request.name, slug: request.slug,
      status: 'active', max_members: maxMembers, max_resources: maxResources }).returning('id').executeTakeFirstOrThrow();
    const roles = await trx.insertInto('roles').values(['admin', 'instructor', 'learner'].map(name => ({
      organization_id: org.id, name, description: null, is_system_role: true,
    }))).returning(['id', 'name']).execute();
    const membership = await trx.insertInto('memberships').values({ user_id: request.adminUserId,
      organization_id: org.id, status: 'active' }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('membership_roles').values({ membership_id: membership.id,
      organization_id: org.id, role_id: roles.find(role => role.name === 'admin')!.id, assigned_by: request.actorUserId }).execute();
    await trx.insertInto('profiles').values({ user_id: request.adminUserId, organization_id: org.id,
      display_name: (await trx.selectFrom('users').select('display_name').where('id', '=', request.adminUserId).executeTakeFirstOrThrow()).display_name,
      bio: null }).execute();
    await trx.insertInto('provisioning_requests').values({ actor_id: request.actorUserId,
      idempotency_key: request.idempotencyKey, payload_hash: hash, organization_id: org.id, membership_id: membership.id }).execute();
    await auditMutation(trx, request, org.id, 'organization.provision', 'organization', org.id, request.adminUserId);
    return { organizationId: org.id, membershipId: membership.id, roles: ['admin'] };
  });
}

export async function setOrganizationStatus(input: MutationContext & {
  organizationId: string; status: 'active' | 'suspended';
  // Trusted authorization result from the caller, never an HTTP body field.
  platformAuthorized?: boolean;
}) {
  return getDb().transaction().execute(async trx => {
    const org = await lockOrganization(trx, input.organizationId);
    if (!input.platformAuthorized) await requireOrganizationAdmin(trx, input.actorUserId, org.id);
    if (org.status === 'archived') throw new ProvisioningError('conflict', 'Archived organization cannot be reactivated');
    if (input.status !== 'active' && input.status !== 'suspended') throw new ProvisioningError('invalid_input', 'Invalid status');
    await trx.updateTable('organizations').set({ status: input.status, updated_at: new Date() }).where('id', '=', org.id).execute();
    await auditMutation(trx, input, org.id, `organization.${input.status === 'active' ? 'reactivate' : 'suspend'}`, 'organization', org.id);
    return { organizationId: org.id, status: input.status };
  });
}

export async function createMember(input: MutationContext & {
  organizationId: string; userId: string; roleName?: string;
}) {
  return getDb().transaction().execute(async trx => {
    const org = await lockOrganization(trx, input.organizationId);
    await requireOrganizationAdmin(trx, input.actorUserId, org.id);
    if (org.status !== 'active') throw new ProvisioningError('forbidden', 'Organization is not active');
    const count = await trx.selectFrom('memberships').select(eb => eb.fn.countAll<string>().as('count'))
      .where('organization_id', '=', org.id).executeTakeFirstOrThrow();
    if (Number(count.count) >= org.max_members) throw new ProvisioningError('quota_exceeded', 'Member quota exceeded');
    const role = await trx.selectFrom('roles').select('id').where('organization_id', '=', org.id)
      .where('name', '=', input.roleName ?? 'learner').executeTakeFirst();
    if (!role) throw new ProvisioningError('invalid_input', 'Unknown organization role');
    const user = await trx.selectFrom('users').select('display_name').where('id', '=', input.userId).executeTakeFirstOrThrow();
    const member = await trx.insertInto('memberships').values({ user_id: input.userId, organization_id: org.id,
      status: 'active' }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('membership_roles').values({ membership_id: member.id, role_id: role.id,
      organization_id: org.id, assigned_by: input.actorUserId }).execute();
    await trx.insertInto('profiles').values({ user_id: input.userId, organization_id: org.id, display_name: user.display_name, bio: null }).execute();
    await auditMutation(trx, input, org.id, 'membership.create', 'membership', member.id, input.userId);
    return { membershipId: member.id };
  });
}
