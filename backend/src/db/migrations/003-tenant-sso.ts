// M5: per-tenant domain and SSO association.
// Federation itself stays in Keycloak (identity brokering). This table only records which
// tenant owns an email domain and which already-configured Keycloak broker alias that
// tenant's users are routed to (via the standard kc_idp_hint authorization parameter).
// Domains are administrator-asserted; DNS ownership verification is out of scope.
export const migrationSql = `
CREATE TABLE organization_sso_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_domain varchar(253) NOT NULL CHECK (email_domain = lower(email_domain) AND email_domain <> ''),
  identity_provider_alias varchar(100) NOT NULL CHECK (identity_provider_alias <> ''),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A domain routes to exactly one tenant; a second claim fails and rolls provisioning back.
  CONSTRAINT organization_sso_domain_unique UNIQUE (email_domain)
);
CREATE INDEX organization_sso_by_org ON organization_sso_configs(organization_id);
`;
