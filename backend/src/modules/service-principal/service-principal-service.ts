// AG01: application service principals.
// Registry lookup and grant-based authorization for non-human callers. Default deny: a service
// principal holds exactly the (tenant, resource, action) grants recorded for it and nothing else.
// It never gets a membership, a role or a just-in-time user row.

import { getDb } from '../../db/connection.js';
import type { AuthorizationDecision, AuthorizationRequest } from '../../common/types.js';
import { AuthenticationError, TenantError } from '../../common/types.js';

export interface ServicePrincipal {
  id: string;
  clientId: string;
  displayName: string;
}

/** Resolve a verified service token to its registered principal. Unknown or disabled: 401. */
export async function resolveServicePrincipal(issuer: string, clientId: string): Promise<ServicePrincipal> {
  const row = await getDb().selectFrom('service_principals')
    .select(['id', 'client_id', 'display_name', 'status'])
    .where('issuer', '=', issuer).where('client_id', '=', clientId)
    .executeTakeFirst();
  if (!row || row.status !== 'active') throw new AuthenticationError('Unregistered or disabled service principal');
  return { id: row.id, clientId: row.client_id, displayName: row.display_name };
}

/**
 * Tenant gate for a service principal: the selected organization must exist, be active and hold at
 * least one grant for this principal. Otherwise 403, exactly like a human without membership.
 */
export async function validateServiceTenant(servicePrincipalId: string, organizationId: string): Promise<{ organizationSlug: string }> {
  const row = await getDb().selectFrom('organizations')
    .innerJoin('service_principal_grants', 'service_principal_grants.organization_id', 'organizations.id')
    .select(['organizations.slug', 'organizations.status'])
    .where('organizations.id', '=', organizationId)
    .where('service_principal_grants.service_principal_id', '=', servicePrincipalId)
    .executeTakeFirst();
  if (!row) throw new TenantError('Service principal has no grant in this organization');
  if (row.status !== 'active') throw new TenantError('Organization is not active');
  return { organizationSlug: row.slug };
}

/** Exact-match grant check. No roles, no Casbin role policies, no inheritance. */
export async function authorizeServicePrincipal(request: AuthorizationRequest, resource: string): Promise<AuthorizationDecision> {
  const deny = (reason: string, policy = 'service-grant'): AuthorizationDecision => ({ allowed: false, reason, policy });
  const db = getDb();
  const org = await db.selectFrom('organizations').select('status').where('id', '=', request.organization).executeTakeFirst();
  if (!org || org.status !== 'active') return deny('Organization is not active');
  const grant = await db.selectFrom('service_principal_grants').select('id')
    .where('service_principal_id', '=', request.subject.userId)
    .where('organization_id', '=', request.organization)
    .where('resource', '=', resource).where('action', '=', request.action)
    .executeTakeFirst();
  if (!grant) return deny('No grant for this service principal, resource and action');
  // A granted per-resource action is still bound to the tenant and to published content.
  if (resource === 'learning-resource' && request.resourceId) {
    const course = await db.selectFrom('learning_resources').select('status')
      .where('id', '=', request.resourceId).where('organization_id', '=', request.organization).executeTakeFirst();
    if (!course) return deny('Resource not found in organization', 'tenant-scope');
    if (course.status !== 'published') return deny('Unpublished resource denied');
  }
  if (resource === 'submission' && request.context?.submissionId !== undefined) {
    return deny('Service principals cannot act on individual submissions');
  }
  return { allowed: true, reason: 'Explicit service principal grant', policy: 'service-grant' };
}
