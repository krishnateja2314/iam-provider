import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { extractBearerToken, validateAccessToken, buildAuthenticatedUser } from './modules/auth/token-validator.js';
import { findOrCreateUser } from './modules/user/user-service.js';
import { validateMembership, findOwnMembership } from './modules/organization/membership-service.js';
import { recordAuditEvent } from './modules/audit/audit-service.js';
import type { AuthenticatedUser, TenantContext, RequestContext } from './common/types.js';
import { AuthenticationError, DependencyError, TenantError } from './common/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthenticatedUser;
    tenant?: TenantContext;
    ctx?: RequestContext;
    correlationId?: string;
  }
}
export const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
export const isUuid = (value: unknown): value is string => typeof value === 'string' && new RegExp(UUID_PATTERN).test(value);

export async function correlationIdHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const value = request.headers['x-correlation-id'];
  request.correlationId = isUuid(value) ? value : randomUUID();
  reply.header('X-Correlation-ID',request.correlationId);
}

export async function auditRequest(request: FastifyRequest, action: string, decision: 'allow'|'deny'|'error', reason: string, resourceType: string|null=null, resourceId: string|null=null): Promise<void> {
  try {
    await recordAuditEvent({actorId:request.auth?.userId??null,actorType:'user',
      organizationId:request.tenant?.organizationId??(isUuid(request.headers['x-organization-id'])?request.headers['x-organization-id']:null),action,decision,reason,
      subjectId:request.auth?.userId??null,resourceType,resourceId,
      correlationId:request.correlationId??null,ipAddress:request.ip});
  } catch { throw Object.assign(new Error('Audit storage unavailable'),{statusCode:503,code:'AUDIT_UNAVAILABLE'}); }
}

export async function authenticationHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const token = extractBearerToken(request.headers.authorization);
    const payload = await validateAccessToken(token,{issuer:process.env.JWT_ISSUER!,audience:process.env.JWT_AUDIENCE!});
    const user = buildAuthenticatedUser(payload);
    const displayName = typeof payload.preferred_username === 'string' ? payload.preferred_username : 'Synthetic user';
    const resolved = await findOrCreateUser(user.issuer,user.keycloakSub,user.email,displayName,payload.email_verified === true);
    user.userId = resolved.userId;
    user.providerSessionId = typeof payload.sid === 'string' ? payload.sid : typeof payload.session_state === 'string' ? payload.session_state : undefined;
    const realmRoles = (payload.realm_access as {roles?:unknown}|undefined)?.roles;
    user.platformAdmin = Array.isArray(realmRoles) && realmRoles.includes('platform-admin');
    request.auth = user;
  } catch(error) {
    // Invalid credential -> 401. Provider/JWKS outage or unsafe config -> 503. Both deny.
    const authError = error instanceof AuthenticationError;
    const reason = authError ? error.message : error instanceof DependencyError ? error.message : 'Authentication dependency unavailable';
    await auditRequest(request,'authentication',authError?'deny':'error',reason);
    reply.code(authError?401:503).send({error:authError?'Invalid API credential':'Authentication service unavailable',code:authError?'AUTHENTICATION_REQUIRED':'DEPENDENCY_UNAVAILABLE'});
  }
}

export async function tenantContextHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth) { reply.code(401).send({error:'Authentication required'});return; }
  const orgId = request.headers['x-organization-id'];
  if (!isUuid(orgId)) {
    await auditRequest(request,'tenant-access','deny','Missing or malformed tenant selector');
    reply.code(400).send({error:'Valid X-Organization-ID required',code:'INVALID_TENANT_FORMAT'});return;
  }
  try {
    const membership = await validateMembership(request.auth.userId,orgId);
    request.tenant = {organizationId:orgId,organizationSlug:membership.organizationSlug,membershipId:membership.membershipId,roles:membership.roles,membershipStatus:membership.membershipStatus};
    request.ctx = {user:request.auth,tenant:request.tenant,correlationId:request.correlationId!,ipAddress:request.ip};
  } catch(error) {
    const denied = error instanceof TenantError;
    await auditRequest(request,'tenant-access',denied?'deny':'error',denied?'Inactive or absent membership/organization':'Tenant storage unavailable');
    reply.code(denied?403:503).send({error:denied?'Access denied':'Tenant service unavailable',code:denied?'TENANT_ACCESS_DENIED':'DEPENDENCY_UNAVAILABLE'});
  }
}

/**
 * Tenant hook for the caller's OWN data under suspension (consent withdrawal only).
 * Same untrusted-selector validation as tenantContextHook and still requires a membership
 * row in the selected organization, so foreign tenants are rejected (403). Unlike
 * tenantContextHook it admits suspended memberships/organizations; the route must then
 * permit only the withdrawal operation and send everything else through permit().
 */
export async function ownMembershipHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth) { reply.code(401).send({error:'Authentication required'});return; }
  const orgId = request.headers['x-organization-id'];
  if (!isUuid(orgId)) {
    await auditRequest(request,'tenant-access','deny','Missing or malformed tenant selector');
    reply.code(400).send({error:'Valid X-Organization-ID required',code:'INVALID_TENANT_FORMAT'});return;
  }
  try {
    const membership = await findOwnMembership(request.auth.userId,orgId);
    request.tenant = {organizationId:orgId,organizationSlug:membership.organizationSlug,membershipId:membership.membershipId,roles:membership.roles,membershipStatus:membership.membershipStatus,organizationStatus:membership.organizationStatus};
    request.ctx = {user:request.auth,tenant:request.tenant,correlationId:request.correlationId!,ipAddress:request.ip};
  } catch(error) {
    const denied = error instanceof TenantError;
    await auditRequest(request,'tenant-access',denied?'deny':'error',denied?'No membership in selected organization':'Tenant storage unavailable');
    reply.code(denied?403:503).send({error:denied?'Access denied':'Tenant service unavailable',code:denied?'TENANT_ACCESS_DENIED':'DEPENDENCY_UNAVAILABLE'});
  }
}
