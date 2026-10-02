export const migrationSql = `
ALTER TABLE organizations ADD COLUMN max_members integer NOT NULL DEFAULT 1000 CHECK (max_members > 0);
ALTER TABLE organizations ADD COLUMN max_resources integer NOT NULL DEFAULT 1000 CHECK (max_resources > 0);
ALTER TABLE memberships ADD CONSTRAINT memberships_id_org_key UNIQUE(id, organization_id);
ALTER TABLE roles ADD CONSTRAINT roles_id_org_key UNIQUE(id, organization_id);
ALTER TABLE learning_resources ADD CONSTRAINT resources_id_org_key UNIQUE(id, organization_id);
ALTER TABLE membership_roles ADD COLUMN organization_id uuid;
UPDATE membership_roles mr SET organization_id = m.organization_id FROM memberships m WHERE m.id = mr.membership_id;
ALTER TABLE membership_roles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE membership_roles ADD CONSTRAINT membership_roles_membership_org_fk FOREIGN KEY(membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE CASCADE;
ALTER TABLE membership_roles ADD CONSTRAINT membership_roles_role_org_fk FOREIGN KEY(role_id, organization_id) REFERENCES roles(id, organization_id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION check_membership_role_same_org() RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM memberships WHERE id = NEW.membership_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
ALTER TABLE teaching_assignments ADD CONSTRAINT teaching_member_org_fk FOREIGN KEY(user_id, organization_id) REFERENCES memberships(user_id, organization_id) ON DELETE CASCADE;
ALTER TABLE teaching_assignments ADD CONSTRAINT teaching_resource_org_fk FOREIGN KEY(resource_id, organization_id) REFERENCES learning_resources(id, organization_id) ON DELETE CASCADE;
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  grade numeric CHECK (grade >= 0 AND grade <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(course_id, organization_id) REFERENCES learning_resources(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(user_id, organization_id) REFERENCES memberships(user_id, organization_id) ON DELETE CASCADE
);
CREATE INDEX submissions_owner ON submissions(user_id, organization_id);
CREATE TABLE provisioning_requests (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key varchar(200) NOT NULL,
  payload_hash text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  PRIMARY KEY(actor_id, idempotency_key)
);
ALTER TABLE consents ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX consent_latest ON consents(user_id, organization_id, purpose, sequence DESC);
CREATE FUNCTION protect_consent_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Consent history is append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER consent_append_only BEFORE UPDATE OR DELETE ON consents FOR EACH ROW EXECUTE FUNCTION protect_consent_history();
ALTER TABLE consents ADD CONSTRAINT supported_consent_purpose CHECK (purpose IN ('profile-sharing', 'analytics')) NOT VALID;
CREATE TABLE policy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_name varchar(100) NOT NULL,
  resource varchar(100) NOT NULL,
  action varchar(100) NOT NULL,
  effect varchar(10) NOT NULL CHECK (effect IN ('allow', 'deny')),
  UNIQUE(organization_id, role_name, resource, action, effect)
);
CREATE FUNCTION enforce_organization_quota() RETURNS trigger AS $$
DECLARE quota integer; used bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id = OLD.organization_id THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'memberships' THEN
    SELECT max_members INTO quota FROM organizations WHERE id = NEW.organization_id FOR UPDATE;
    SELECT count(*) INTO used FROM memberships WHERE organization_id = NEW.organization_id;
  ELSE
    SELECT max_resources INTO quota FROM organizations WHERE id = NEW.organization_id FOR UPDATE;
    SELECT count(*) INTO used FROM learning_resources WHERE organization_id = NEW.organization_id;
  END IF;
  IF used >= quota THEN RAISE EXCEPTION 'Organization quota exceeded' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER membership_quota BEFORE INSERT OR UPDATE OF organization_id ON memberships FOR EACH ROW EXECUTE FUNCTION enforce_organization_quota();
CREATE TRIGGER resource_quota BEFORE INSERT OR UPDATE OF organization_id ON learning_resources FOR EACH ROW EXECUTE FUNCTION enforce_organization_quota();
`;
