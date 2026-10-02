// Common types used across all modules

export interface AuthenticatedUser {
  /** Internal platform user ID */
  userId: string;
  /** Keycloak subject claim */
  keycloakSub: string;
  /** Email from token */
  email?: string;
  /** Token issuer */
  issuer: string;
  providerSessionId?: string;
  platformAdmin?: boolean;
}

export interface TenantContext {
  /** Selected organization ID (validated) */
  organizationId: string;
  /** Organization slug */
  organizationSlug: string;
  /** User's membership ID in this org */
  membershipId: string;
  /** User's roles in this org */
  roles: string[];
  /** Membership status */
  membershipStatus: string;
}

export interface RequestContext {
  user: AuthenticatedUser;
  tenant: TenantContext;
  correlationId: string;
  ipAddress: string;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
  policy?: string;
}

export interface AuthorizationRequest {
  subject: AuthenticatedUser;
  organization: string;
  resource: string;
  resourceId?: string;
  action: string;
  context?: Record<string, unknown>;
}

export type AuditDecision = 'allow' | 'deny' | 'error';

export interface AuditEntry {
  actorId: string | null;
  actorType: 'user' | 'system' | 'service';
  subjectId?: string | null;
  organizationId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  decision: AuditDecision;
  reason: string | null;
  correlationId: string | null;
  ipAddress: string | null;
  metadata?: Record<string, unknown> | null;
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(401, message, 'AUTHENTICATION_REQUIRED');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(403, message, 'ACCESS_DENIED');
  }
}

export class TenantError extends AppError {
  constructor(message: string = 'Invalid organization context') {
    super(403, message, 'TENANT_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(404, message, 'NOT_FOUND');
  }
}
