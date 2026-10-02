# ADR-002: Casbin With Application-Owned Security Boundaries

## Status and Context

Accepted; implementation reviewed 2026-10-02. This supersedes the older Casbin 5.30.0/allow-only description, not a deployed compatibility contract.

The application needs tenant-scoped RBAC, active membership/organization checks, unpublished-resource restrictions, submission ownership, and teaching relationships. Keycloak authenticates identities; it is not the source of tenant permissions. Decisions must reflect current database roles and policy changes without waiting for an access token to expire.

## Decision

Use the pinned Node `casbin` **5.51.1** dependency through `backend/src/modules/authorization/authorization-engine.ts`. Keep the domain facts in PostgreSQL. The adapter combines source-controlled baseline permissions with the selected organization's dynamic `policy_rules` rows and creates a fresh enforcer for each decision.

The actual PERM model is:

```ini
[request_definition]
r = roles, obj, act
[policy_definition]
p = role, obj, act, eft
[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))
[matchers]
m = hasRole(r.roles, p.role) && r.obj == p.obj && r.act == p.act
```

Tenant isolation is enforced by the adapter's database queries, **not** a Casbin domain field. `roles` is the set of current role names for that membership. A matching deny for any role in that set overrides matching allows, including a baseline admin allow. No matching allow means deny. Dynamic allow rows augment the baseline; they cannot override an earlier hard boundary denial.

## Decision Order

1. Resolve membership for `(subject.userId, organization)` and require active membership and active organization.
2. Load roles from membership assignments joined to roles in that organization.
3. For a resource ID, require a tenant-bound lookup; non-admin readers cannot read unpublished learning resources.
4. For submission IDs, resolve tenant-bound submission and course. Non-admin/non-instructor readers must own it. Non-admin instructors reading or grading must teach the course. Submission creation requires a published course in the selected tenant.
5. Read only that organization's `policy_rules`, combine with baseline, and evaluate all current roles together using deny-overrides.
6. Return default deny for unmatched actions, or `error-failclosed` for storage/evaluation exceptions.

List handlers additionally filter their SQL results: organization for resources, ownership for learners' submissions, and assigned courses for instructors' submissions. A collection-level policy allow is not permission to return every database row.

## Alternatives

| Alternative | Why Not Selected Here |
|---|---|
| Keycloak Authorization Services | Capable of fine-grained authorization, but would require synchronizing this project's tenant, membership, resource, and teaching facts into a second policy/resource model. The choice is about complexity and source-of-truth consistency, not a claim that Keycloak cannot express these rules. |
| Entirely custom permission functions | Simple initially, but policy effect precedence and changing permissions would become scattered application logic. Hard domain boundaries remain custom; the role/action/effect decision is delegated to an established engine. |
| Dedicated external policy/relationship service | Useful at a different scale, but adds deployment, synchronization, and availability work not justified by this modular monolith. |

## Interface and Administration

`authorize(AuthorizationRequest): Promise<AuthorizationDecision>` accepts subject, organization, resource, action, optional resource ID and context. It returns `allowed`, an internal reason, and a policy identifier. See `backend/src/common/types.ts` for the authoritative types. The HTTP adapter avoids exposing detailed policy reasons for ordinary authorization denials.

`POST /api/v1/policies` permits a tenant admin to insert an allow or deny row. Inputs are enumerated by the route schema; insert and audit share a transaction. There is no policy delete/update/list API or policy administration UI. The unique key includes effect, so corresponding allow and deny rows may coexist; deny wins. Direct database edits are privileged operations and are not equivalent to an audited public administration API.

## Consequences and Caveats

- Current database roles and policies affect the next decision; there is no application permission cache to invalidate.
- Rebuilding an enforcer and rereading facts costs database work per decision. No performance target or benchmark is claimed.
- Hard tenant/relationship boundaries cannot be bypassed by inserting a policy allow. Conversely, policy denies can reduce baseline permissions.
- A platform-admin provider role authorizes platform provisioning/status routes only; it does not bypass tenant membership or grant tenant resource access.
- Domain status/relationship reads and all later mutations are not universally one serializable authorization transaction. Selected sensitive services recheck under locks; do not claim global race-free revocation.
- An allow result is not itself an audit write. Route handlers and transactional services own audit recording.
- Tests for baseline combinations, cross-tenant access, teaching/owner boundaries, dynamic deny, and role removal exist in `tests/security/t05-t08-authorization.test.ts`. Their latest execution status is tracked separately in `../traceability-matrix.md`, not inferred from this ADR.
