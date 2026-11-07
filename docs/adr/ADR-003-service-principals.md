# ADR-003: Application Service Principals (AG01)

## Status and Context

Accepted 2026-11-07 (W5). The W4 report committed to one executable agent outcome: a reporting agent
that calls the API without a human, holds exactly one action in exactly one tenant, and leaves an
audit trail that names it as a service. AG02 (user-delegated agents) is still not implemented.

Before this change every caller was a human: `authenticationHook` created a user just-in-time from
`(issuer, subject)`, and authority came from memberships and roles. Reusing that path for an agent
would have created a fake "user" for the agent, given it a membership, and let any role change
silently widen what the agent can do.

## Decision

1. **Keycloak client.** `iam-agent-reporting` is a confidential client with only the
   client-credentials grant (no browser flow, no password grant), `fullScopeAllowed=false` (no realm
   roles in its tokens), default scopes `basic` and `iam-api` (audience `iam-backend`), a 60 s
   access-token lifespan and no refresh token. A hardcoded-claim mapper stamps
   `principal_kind=service` on its access tokens.
2. **Explicit principal kind.** The token validator treats `principal_kind=service` as a separate
   path. Such a token must carry `azp`, must not carry a user session (`sid`/`session_state`) and,
   if present, `client_id` must equal `azp`. Introspection must report it active, issued to the same
   client, for the same subject, with username `service-account-<client>` and `principal_kind=service`.
   Any other `principal_kind` value is rejected. The human `azp` allowlist does not apply to this path.
3. **Registry, not just-in-time users.** `service_principals(issuer, client_id, status)` (migration
   004) is the allowlist of service clients. An unregistered or disabled principal gets 401. A
   service token never creates a `users`, `authentication_identities` or `memberships` row.
4. **Grants, not roles.** `service_principal_grants(service_principal_id, organization_id, resource,
   action)` lists exactly what the principal may do. The tenant gate requires an active organization
   in which the principal holds at least one grant (403 otherwise). `authorize()` then requires an
   exact `(tenant, resource, action)` grant. Casbin role policies and tenant `policy_rules` are never
   consulted for a service principal.
5. **Route classes.** Tenant routes use `principalAuthenticationHook` (human or service), so every
   allow still goes through `permit()`. Identity, session, consent and platform routes keep
   `authenticationHook`, which now refuses service principals with 403 `PRINCIPAL_KIND_NOT_ALLOWED`.
6. **Audit.** Rows written for a service caller have `actor_type='service'`, the service principal
   ID as `actor_id`/`subject_id`, and `metadata.clientId`.

The seed registers `iam-agent-reporting` for the running issuer with one grant:
Acme, `learning-resource`, `list`.

## Consequences

- Disabling the Keycloak client denies an already-issued token on the next request, because
  introspection reports it inactive. Re-enabling the client makes a still-unexpired token valid
  again (observed on Keycloak 26.8.0). Use the registry status (`disabled`) when an agent must stay
  off regardless of the provider.
- Grants are managed in the database (seed or administrator). There is no grant-management API yet.
- The live test toggles the agent client through the local bootstrap admin, because
  `iam-provider-admin` deliberately cannot manage clients. This only works in the synthetic lab.

## Evidence

`backend/tests/security/service-principal.test.ts`: 23 fixture/HTTP and introspection cases on real
PostgreSQL, plus 7 live cases with real Keycloak client-credentials tokens. Mutations M8 to M11 in
`scripts/verify-test-independence.mjs` break the registry status check, the service-account
binding, the human-only route guard and the exact-action match. See `docs/verification-evidence.md`.
