// Database migration runner
// Creates all tables with constraints and indexes.

export const migrationSql = `
-- ============================================================
-- IAM Platform Database Schema
-- Version: 1.0.0
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Users: Global identity, not tied to any organization
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Authentication Identities: External IdP link
-- Key: (issuer, subject) must be unique globally
-- We do NOT merge accounts by email
-- ============================================================
CREATE TABLE IF NOT EXISTS authentication_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer VARCHAR(512) NOT NULL,
  subject VARCHAR(512) NOT NULL,
  email VARCHAR(512),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  provider_metadata JSONB,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issuer, subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON authentication_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_issuer_subject ON authentication_identities(issuer, subject);

-- ============================================================
-- Organizations: Tenants
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Profiles: Per-organization user profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, organization_id)
);

-- ============================================================
-- Memberships: A user's membership in an organization
-- UNIQUE(user_id, organization_id) prevents duplicate memberships
-- ============================================================
CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org_id ON memberships(organization_id);

-- ============================================================
-- Roles: Organization-scoped roles
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roles_org_id ON roles(organization_id);

-- ============================================================
-- Membership Roles: Links a membership to a role
-- Both must belong to the same organization (enforced by application + trigger)
-- ============================================================
CREATE TABLE IF NOT EXISTS membership_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  UNIQUE(membership_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_roles_membership ON membership_roles(membership_id);

-- ============================================================
-- Learning Resources: Owned by an organization
-- ============================================================
CREATE TABLE IF NOT EXISTS learning_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  resource_type VARCHAR(50) NOT NULL DEFAULT 'course' CHECK (resource_type IN ('course', 'module', 'lesson', 'assignment')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_resources_org ON learning_resources(organization_id);

-- ============================================================
-- Teaching Assignments: Links instructor to resource within same org
-- ============================================================
CREATE TABLE IF NOT EXISTS teaching_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'instructor' CHECK (role IN ('instructor', 'assistant', 'grader')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_teaching_assignments_resource ON teaching_assignments(resource_id);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_user_org ON teaching_assignments(user_id, organization_id);

-- ============================================================
-- Consents: Purpose-specific consent records
-- ============================================================
CREATE TABLE IF NOT EXISTS consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  purpose VARCHAR(255) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  ip_address VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(user_id);

-- ============================================================
-- Audit Events: Queryable security audit log
-- Never stores tokens, passwords, or unnecessary PII
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  actor_type VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'service')),
  subject_id UUID,
  organization_id UUID,
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100),
  resource_id UUID,
  decision VARCHAR(10) NOT NULL CHECK (decision IN ('allow', 'deny', 'error')),
  reason VARCHAR(500),
  correlation_id UUID,
  ip_address VARCHAR(45),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_correlation ON audit_events(correlation_id);

-- ============================================================
-- Cross-organization constraint trigger:
-- Ensure membership_roles.role belongs to the same org as the membership
-- ============================================================
CREATE OR REPLACE FUNCTION check_membership_role_same_org()
RETURNS TRIGGER AS $$
DECLARE
  membership_org UUID;
  role_org UUID;
BEGIN
  SELECT organization_id INTO membership_org FROM memberships WHERE id = NEW.membership_id;
  SELECT organization_id INTO role_org FROM roles WHERE id = NEW.role_id;
  
  IF membership_org IS DISTINCT FROM role_org THEN
    RAISE EXCEPTION 'Role and membership must belong to the same organization';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_membership_role_same_org ON membership_roles;
CREATE TRIGGER trg_membership_role_same_org
  BEFORE INSERT OR UPDATE ON membership_roles
  FOR EACH ROW EXECUTE FUNCTION check_membership_role_same_org();

-- ============================================================
-- Cross-organization constraint trigger:
-- Ensure teaching_assignments.resource belongs to the same org
-- ============================================================
CREATE OR REPLACE FUNCTION check_teaching_assignment_same_org()
RETURNS TRIGGER AS $$
DECLARE
  resource_org UUID;
BEGIN
  SELECT organization_id INTO resource_org FROM learning_resources WHERE id = NEW.resource_id;
  
  IF resource_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Teaching assignment and resource must belong to the same organization';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_teaching_assignment_same_org ON teaching_assignments;
CREATE TRIGGER trg_teaching_assignment_same_org
  BEFORE INSERT OR UPDATE ON teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION check_teaching_assignment_same_org();
`;
