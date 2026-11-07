// W5 / AG01: application service principals (non-human callers).
// A service principal is NOT a user: it has no membership, no role and no profile, and it is
// never created just-in-time from a token. It is keyed by (issuer, client_id) of a confidential
// client that may only use the client-credentials grant. Its authority is an explicit list of
// (tenant, resource, action) grants; anything not listed is denied.
export const migrationSql = `
CREATE TABLE service_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer varchar(500) NOT NULL CHECK (issuer <> ''),
  client_id varchar(255) NOT NULL CHECK (client_id <> ''),
  display_name varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_principal_identity UNIQUE (issuer, client_id)
);
CREATE TABLE service_principal_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_principal_id uuid NOT NULL REFERENCES service_principals(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource varchar(100) NOT NULL CHECK (resource <> ''),
  action varchar(100) NOT NULL CHECK (action <> ''),
  granted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_principal_grant_unique UNIQUE (service_principal_id, organization_id, resource, action)
);
CREATE INDEX service_principal_grants_lookup ON service_principal_grants(service_principal_id, organization_id);
`;
