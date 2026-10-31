// Organization & Membership Management Module
// Handles tenant context resolution and membership validation.

import { getDb } from '../../db/connection.js';
import { TenantError } from '../../common/types.js';

export interface MembershipInfo {
  membershipId: string;
  userId: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  organizationStatus: string;
  membershipStatus: string;
  roles: string[];
}

/**
 * Validate that a user has an active membership in the specified organization.
 * The organization ID comes from the request and is treated as UNTRUSTED input.
 * 
 * Returns full membership info including roles, or throws TenantError.
 */
export async function validateMembership(
  userId: string,
  organizationId: string
): Promise<MembershipInfo> {
  const db = getDb();

  // Step 1: Verify the organization exists and is active
  const org = await db
    .selectFrom('organizations')
    .select(['id', 'slug', 'name', 'status'])
    .where('id', '=', organizationId)
    .executeTakeFirst();

  if (!org) {
    throw new TenantError('Organization not found');
  }

  if (org.status !== 'active') {
    throw new TenantError('Organization is not active');
  }

  // Step 2: Find the user's membership in this organization
  const membership = await db
    .selectFrom('memberships')
    .select(['id', 'status'])
    .where('user_id', '=', userId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();

  if (!membership) {
    throw new TenantError('User is not a member of this organization');
  }

  if (membership.status !== 'active') {
    throw new TenantError('Membership is not active');
  }

  // Step 3: Load roles for this membership
  const membershipRoles = await db
    .selectFrom('membership_roles')
    .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
    .select(['roles.name'])
    .where('membership_roles.membership_id', '=', membership.id)
    .execute();

  const roles = membershipRoles.map((r) => r.name);

  return {
    membershipId: membership.id,
    userId,
    organizationId: org.id,
    organizationSlug: org.slug,
    organizationName: org.name,
    organizationStatus: org.status,
    membershipStatus: membership.status,
    roles,
  };
}

/**
 * Ownership check WITHOUT the active-status requirement.
 * Used only where a suspended member must still be able to act on their own data
 * (consent withdrawal). Still rejects unknown organizations and non-members, so it
 * never admits a foreign tenant. Roles are loaded only for an active member in an
 * active organization; otherwise the caller holds no tenant roles.
 */
export async function findOwnMembership(
  userId: string,
  organizationId: string
): Promise<MembershipInfo> {
  const db = getDb();
  const row = await db
    .selectFrom('memberships')
    .innerJoin('organizations', 'organizations.id', 'memberships.organization_id')
    .select(['memberships.id as membershipId', 'memberships.status as membershipStatus',
      'organizations.slug', 'organizations.name', 'organizations.status as organizationStatus'])
    .where('memberships.user_id', '=', userId)
    .where('memberships.organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!row) {
    throw new TenantError('User is not a member of this organization');
  }
  const active = row.membershipStatus === 'active' && row.organizationStatus === 'active';
  const roles = active
    ? (await db.selectFrom('membership_roles').innerJoin('roles', 'roles.id', 'membership_roles.role_id')
        .select('roles.name').where('membership_roles.membership_id', '=', row.membershipId).execute()).map(r => r.name)
    : [];
  return {
    membershipId: row.membershipId,
    userId,
    organizationId,
    organizationSlug: row.slug,
    organizationName: row.name,
    organizationStatus: row.organizationStatus,
    membershipStatus: row.membershipStatus,
    roles,
  };
}

/**
 * List all organizations a user has active memberships in.
 */
export async function listUserOrganizations(userId: string): Promise<Array<{
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roles: string[];
  status: string;
}>> {
  const db = getDb();

  const memberships = await db
    .selectFrom('memberships')
    .innerJoin('organizations', 'organizations.id', 'memberships.organization_id')
    .select([
      'memberships.id as membershipId',
      'organizations.id as organizationId',
      'organizations.name as organizationName',
      'organizations.slug as organizationSlug',
      'memberships.status',
    ])
    .where('memberships.user_id', '=', userId)
    .where('memberships.status', '=', 'active')
    .where('organizations.status', '=', 'active')
    .execute();

  const results = [];
  for (const m of memberships) {
    const roles = await db
      .selectFrom('membership_roles')
      .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
      .select(['roles.name'])
      .where('membership_roles.membership_id', '=', m.membershipId)
      .execute();

    results.push({
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      organizationSlug: m.organizationSlug,
      roles: roles.map((r) => r.name),
      status: m.status,
    });
  }

  return results;
}

/**
 * Find organization by slug.
 */
export async function findOrganizationBySlug(slug: string) {
  const db = getDb();
  return db
    .selectFrom('organizations')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst();
}
