// Final / AG02: user-delegated agents.
// A delegation lets one user hand a registered, delegable service principal a short list of
// scopes ("resource:action") in ONE organization, for a bounded time. At every decision the agent
// gets the intersection: delegator's current permission AND delegated scope AND tenant context.
// The composite foreign key ties a delegation to an existing (user, organization) membership, so
// the database refuses a delegation in a tenant the user does not belong to, and deleting the
// membership deletes its delegations.
export const migrationSql = `
ALTER TABLE service_principals ADD COLUMN delegable boolean NOT NULL DEFAULT false;
CREATE TABLE agent_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_principal_id uuid NOT NULL REFERENCES service_principals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 20),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_delegation_membership FOREIGN KEY (user_id, organization_id)
    REFERENCES memberships(user_id, organization_id) ON DELETE CASCADE,
  CONSTRAINT agent_delegation_expiry CHECK (expires_at > created_at)
);
CREATE INDEX agent_delegations_owner ON agent_delegations(user_id, organization_id);
CREATE INDEX agent_delegations_agent ON agent_delegations(service_principal_id);
`;
