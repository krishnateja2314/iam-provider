// Database schema types for Kysely
// These match the migration-created tables exactly.

import type { Generated, ColumnType } from 'kysely';

export interface UserTable {
  id: Generated<string>;
  display_name: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuthenticationIdentityTable {
  id: Generated<string>;
  user_id: string;
  issuer: string;
  subject: string;
  email: string | null;
  email_verified: boolean;
  provider_metadata: unknown | null;
  linked_at: Generated<Date>;
}

export interface ProfileTable {
  id: Generated<string>;
  user_id: string;
  organization_id: string;
  display_name: string;
  bio: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganizationTable {
  id: Generated<string>;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
  max_members: Generated<number>;
  max_resources: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MembershipTable {
  id: Generated<string>;
  user_id: string;
  organization_id: string;
  status: 'active' | 'inactive' | 'suspended';
  joined_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RoleTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  description: string | null;
  is_system_role: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface MembershipRoleTable {
  id: Generated<string>;
  membership_id: string;
  role_id: string;
  organization_id: Generated<string>;
  assigned_at: Generated<Date>;
  assigned_by: string | null;
}

export interface LearningResourceTable {
  id: Generated<string>;
  organization_id: string;
  title: string;
  description: string | null;
  resource_type: 'course' | 'module' | 'lesson' | 'assignment';
  status: 'draft' | 'published' | 'archived';
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TeachingAssignmentTable {
  id: Generated<string>;
  user_id: string;
  organization_id: string;
  resource_id: string;
  role: 'instructor' | 'assistant' | 'grader';
  assigned_at: Generated<Date>;
}

export interface ConsentTable {
  sequence: Generated<string>;
  id: Generated<string>;
  user_id: string;
  organization_id: string | null;
  purpose: string;
  granted: boolean;
  granted_at: Generated<Date>;
  revoked_at: Date | null;
  ip_address: string | null;
}

export interface AuditEventTable {
  id: Generated<string>;
  timestamp: Generated<Date>;
  actor_id: string | null;
  actor_type: 'user' | 'system' | 'service';
  subject_id: string | null;
  organization_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  decision: 'allow' | 'deny' | 'error';
  reason: string | null;
  correlation_id: string | null;
  ip_address: string | null;
  metadata: unknown | null;
}

export interface Database {
  policy_rules: PolicyRuleTable;
  submissions: SubmissionTable;
  provisioning_requests: ProvisioningRequestTable;
  users: UserTable;
  authentication_identities: AuthenticationIdentityTable;
  profiles: ProfileTable;
  organizations: OrganizationTable;
  memberships: MembershipTable;
  roles: RoleTable;
  membership_roles: MembershipRoleTable;
  learning_resources: LearningResourceTable;
  teaching_assignments: TeachingAssignmentTable;
  consents: ConsentTable;
  audit_events: AuditEventTable;
}

export interface SubmissionTable {
  id: Generated<string>;
  course_id: string;
  organization_id: string;
  user_id: string;
  content: Generated<string>;
  grade: ColumnType<string | null, number | string | null, number | string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProvisioningRequestTable {
  actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  organization_id: string;
  membership_id: string;
}

export interface PolicyRuleTable {
  id: Generated<string>;
  organization_id: string;
  role_name: string;
  resource: string;
  action: string;
  effect: 'allow' | 'deny';
}
