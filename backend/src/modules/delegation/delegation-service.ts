// Final / AG02: user-delegated agents.
// A user may let a registered, delegable agent act for them in one organization, with a short list
// of scopes and an expiry. The agent's effective permission at every decision is
//
//   delegator's current permission  AND  delegated scope  AND  tenant context
//
// The delegation is re-read on every authorization decision (no cache), so revocation, expiry,
// a lost role or a suspended membership take effect on the agent's next request.

import { sql } from 'kysely';
import { getDb } from '../../db/connection.js';
import { recordAuditEvent } from '../audit/audit-service.js';
import { AppError, AuthenticationError } from '../../common/types.js';

/**
 * Scopes a user may delegate. Administrative actions (member, policy, audit, consent and resource
 * creation) are never delegable, even by an administrator: an agent must not change who belongs to
 * a tenant, what the policy is, or read the tenant's audit trail.
 */
export const DELEGABLE_SCOPES = [
  'learning-resource:list', 'learning-resource:read',
  'submission:list', 'submission:read', 'submission:submit', 'submission:grade',
  'profile:read',
] as const;

export const MAX_DELEGATION_SECONDS = 30 * 24 * 3600;

export interface ActiveDelegation {
  id: string;
  userId: string;
  organizationId: string;
  scopes: string[];
  expiresAt: Date;
}

const activeRow = (servicePrincipalId: string | undefined, delegationId: string) => {
  let query = getDb().selectFrom('agent_delegations')
    .innerJoin('service_principals', 'service_principals.id', 'agent_delegations.service_principal_id')
    .select(['agent_delegations.id', 'agent_delegations.user_id', 'agent_delegations.organization_id', 'agent_delegations.scopes', 'agent_delegations.expires_at'])
    .where('agent_delegations.id', '=', delegationId)
    .where('agent_delegations.revoked_at', 'is', null)
    .where('agent_delegations.expires_at', '>', sql<Date>`now()`)
    .where('service_principals.status', '=', 'active')
    .where('service_principals.delegable', '=', true);
  if (servicePrincipalId) query = query.where('agent_delegations.service_principal_id', '=', servicePrincipalId);
  return query.executeTakeFirst();
};

/**
 * Authentication step: the delegation named by X-Delegation-ID must belong to the calling agent,
 * be unrevoked and unexpired, and the agent must still be active and delegable. Otherwise 401:
 * the agent's credential is valid but it holds no authority to act for anyone.
 */
export async function resolveDelegation(servicePrincipalId: string, delegationId: string): Promise<ActiveDelegation> {
  const row = await activeRow(servicePrincipalId, delegationId);
  if (!row) throw new AuthenticationError('Unknown, revoked or expired delegation');
  return { id: row.id, userId: row.user_id, organizationId: row.organization_id, scopes: row.scopes, expiresAt: row.expires_at };
}

/**
 * Authorization step, evaluated on every decision before the delegator's own permission is checked.
 * Returns a deny reason, or null when the delegation is still active in this tenant and holds the
 * exact scope.
 */
export async function delegationScopeDenial(delegationId: string, servicePrincipalId: string, organizationId: string, resource: string, action: string): Promise<string | null> {
  const row = await activeRow(servicePrincipalId, delegationId);
  if (!row) return 'Delegation revoked, expired or agent disabled';
  if (row.organization_id !== organizationId) return 'Delegation is bound to another organization';
  if (!row.scopes.includes(`${resource}:${action}`)) return 'Action outside the delegated scope';
  return null;
}

export class DelegationError extends AppError {
  constructor(message: string, code = 'DELEGATION_INVALID', status = 400) {
    super(status, message, code);
    this.name = 'DelegationError';
  }
}

interface Actor { userId: string; organizationId: string; correlationId: string; ipAddress: string; issuer: string }

/** Create a delegation for the caller in the selected organization; audited in the same transaction. */
export async function createDelegation(input: Actor & { agentClientId: string; scopes: string[]; expiresInSeconds: number }) {
  const scopes = [...new Set(input.scopes)];
  for (const scope of scopes) {
    if (!(DELEGABLE_SCOPES as readonly string[]).includes(scope)) throw new DelegationError(`Scope is not delegable: ${scope}`, 'SCOPE_NOT_DELEGABLE');
  }
  if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds < 60 || input.expiresInSeconds > MAX_DELEGATION_SECONDS) {
    throw new DelegationError('Expiry must be between 60 seconds and 30 days');
  }
  return getDb().transaction().execute(async trx => {
    const agent = await trx.selectFrom('service_principals').select(['id', 'status', 'delegable', 'display_name'])
      .where('issuer', '=', input.issuer).where('client_id', '=', input.agentClientId).executeTakeFirst();
    if (!agent || agent.status !== 'active' || !agent.delegable) throw new DelegationError('Agent is not registered for delegation', 'AGENT_NOT_DELEGABLE');
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    const row = await trx.insertInto('agent_delegations').values({
      service_principal_id: agent.id, user_id: input.userId, organization_id: input.organizationId, scopes, expires_at: expiresAt, revoked_at: null,
    }).returning(['id', 'scopes', 'expires_at', 'created_at']).executeTakeFirstOrThrow();
    await recordAuditEvent({ actorId: input.userId, actorType: 'user', subjectId: input.userId, organizationId: input.organizationId,
      action: 'delegation.create', resourceType: 'delegation', resourceId: row.id, decision: 'allow', reason: 'User delegated scopes to agent',
      correlationId: input.correlationId, ipAddress: input.ipAddress, metadata: { agentClientId: input.agentClientId, scopes, expiresAt: expiresAt.toISOString() } }, trx);
    return { delegation: { id: row.id, agentClientId: input.agentClientId, agentName: agent.display_name, scopes: row.scopes, expiresAt: row.expires_at, createdAt: row.created_at } };
  });
}

/** The caller's own delegations in the selected organization. */
export async function listDelegations(userId: string, organizationId: string) {
  const rows = await getDb().selectFrom('agent_delegations')
    .innerJoin('service_principals', 'service_principals.id', 'agent_delegations.service_principal_id')
    .select(['agent_delegations.id', 'service_principals.client_id', 'agent_delegations.scopes', 'agent_delegations.expires_at', 'agent_delegations.revoked_at', 'agent_delegations.created_at'])
    .where('agent_delegations.user_id', '=', userId).where('agent_delegations.organization_id', '=', organizationId)
    .orderBy('agent_delegations.created_at', 'desc').limit(100).execute();
  const now = Date.now();
  return rows.map(row => ({ id: row.id, agentClientId: row.client_id, scopes: row.scopes, expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at,
    active: row.revoked_at === null && row.expires_at.getTime() > now }));
}

/** Revoke one of the caller's own delegations. Another user's delegation, or one in another tenant, is "not found". */
export async function revokeDelegation(input: Actor & { delegationId: string }): Promise<boolean> {
  return getDb().transaction().execute(async trx => {
    const row = await trx.updateTable('agent_delegations').set({ revoked_at: new Date() })
      .where('id', '=', input.delegationId).where('user_id', '=', input.userId).where('organization_id', '=', input.organizationId)
      .where('revoked_at', 'is', null).returning('id').executeTakeFirst();
    if (!row) return false;
    await recordAuditEvent({ actorId: input.userId, actorType: 'user', subjectId: input.userId, organizationId: input.organizationId,
      action: 'delegation.revoke', resourceType: 'delegation', resourceId: row.id, decision: 'allow', reason: 'Delegator revoked delegation',
      correlationId: input.correlationId, ipAddress: input.ipAddress }, trx);
    return true;
  });
}
