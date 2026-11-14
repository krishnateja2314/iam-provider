# ADR-004: User-Delegated Agents (AG02)

## Status and Context

Accepted 2026-11-14 (final submission). The Week 1 design (Section "Agent Identity and Delegation")
promised that an agent could act for a user, with security invariant 7: *an agent cannot have more
effective permission than its delegating user*. It also listed authorization scenarios 13 ("agent
reads with delegation: allow") and 14 ("agent acts without the delegated scope: deny"). Until this
change only AG01 existed (ADR-003): an agent acting as itself with fixed grants. AG02 was listed as
future work in the W4 and W5 reports and in the final-report draft of 2026-11-07.

## Decision

1. **The agent is still a service principal.** It authenticates with the client-credentials grant
   (`iam-agent-assistant`, `principal_kind=service`, 60 s tokens, no refresh token), exactly like
   AG01, so all of ADR-003's token checks apply (no user session, `client_id == azp`, introspection
   bound to the client's own service account). The registry row is marked `delegable = true` and the
   agent holds **no grants of its own**: without a delegation it can do nothing in any tenant (403).
2. **Delegation record.** `agent_delegations(service_principal_id, user_id, organization_id,
   scopes[], expires_at, revoked_at)` (migration 005). A composite foreign key to
   `memberships(user_id, organization_id)` means the database refuses a delegation in a tenant the
   user does not belong to, and deleting the membership deletes its delegations.
3. **Who may delegate what.** A human member creates a delegation for themself in the selected
   tenant (`POST /api/v1/delegations`, Casbin `delegation:manage`, allowed to every role by default
   and deniable per tenant through `policy_rules`). Scopes are `resource:action` strings from a fixed
   delegable list: `learning-resource:list|read`, `submission:list|read|submit|grade`,
   `profile:read`. Administrative actions (`member:manage`, `policy:manage`, `audit:read`,
   `consent:manage`, `learning-resource:create|update`) are never delegable, even by a tenant
   admin: an agent must not change who belongs to a tenant, change policy or read the audit trail.
   Expiry is 60 s to 30 days. Only an active, delegable agent can receive a delegation.
4. **How the agent uses it.** The agent sends its own token plus `X-Delegation-ID` and
   `X-Organization-ID`. Authentication resolves the delegation: it must belong to this agent, be
   unrevoked and unexpired, and the agent must be active and delegable (otherwise 401). The request
   is then evaluated **as the delegator** (`userId` = the user, so ownership and teaching checks are
   the user's), with three gates:
   - **tenant context:** the selected organization must equal the delegation's organization, and
     the user must still be an active member of an active organization (`tenantContextHook`, 403);
   - **delegated scope:** `authorize()` re-reads the delegation on every decision and requires the
     exact `resource:action` scope (403, policy `delegation-scope`);
   - **user permission:** the normal hard boundaries (published-only, ownership, teaching
     relationship) and Casbin deny-overrides over the user's *current* roles.

   Effective permission = user permission AND delegated scope AND tenant context.
5. **Route classes.** Delegated agents use tenant routes only. Identity, session, consent, platform
   and the delegation routes themselves use `authenticationHook`, which refuses any service
   credential (403 `PRINCIPAL_KIND_NOT_ALLOWED`), so an agent cannot re-delegate. A human token
   that carries `X-Delegation-ID` is refused with 400 `DELEGATION_NOT_ALLOWED`.
6. **Revocation.** `DELETE /api/v1/delegations/:id` revokes the caller's own delegation. It needs
   only an active membership, not `delegation:manage`, so a tenant policy that blocks creating
   delegations never blocks withdrawing one. Because the delegation is re-read on every request,
   revocation, expiry, a lost role and a suspended membership all apply on the agent's next request.
7. **Audit.** Delegation create and revoke are written in the same transaction as the change, with
   the user as actor. Agent requests are written with `actor_type='service'`, the agent as
   `actor_id`, the delegator as `subject_id`, and `metadata = {clientId, delegationId, onBehalfOf}`.

## Alternatives Considered

- **OAuth 2.0 Token Exchange (RFC 8693) with an `act` claim.** The standard shape for delegation, and
  Keycloak 26 supports standard token exchange. Rejected for this prototype: the provider would have
  to mint user-bound tokens for the agent, our backend would still need the delegation record for
  scopes and revocation, and live revocation would depend on provider token state. The delegation
  record plus uncached re-check gives the same security property with one source of truth.
- **Copy the user's roles onto the agent.** Rejected: the agent's authority would not shrink when
  the user loses a role, which is exactly invariant 7.

## Consequences

- One extra indexed lookup per authorization decision for delegated agents.
- The delegable-scope list is code, not data; changing it is a reviewed code change.
- Delegations are per user and per tenant; there is no admin view of other users' delegations yet.
- Synthetic lab only: the assistant's client secret is a public development value.

## Evidence

`backend/tests/security/delegation.test.ts`: 22 fixture cases through the real Fastify routes on
PostgreSQL and 4 live cases with real Keycloak client-credentials tokens. Mutations M12 to M15 in
`scripts/verify-test-independence.mjs` remove the scope check, the intersection with the user's
permission, the revocation check and the delegable-agent check. `scripts/verify-pkce.mjs` creates a
delegation from the real browser client and checks the agent against it.
`scripts/demo-delegation.mjs` is the presentation demo. See `docs/verification-evidence.md`.
