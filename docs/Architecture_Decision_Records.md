# Architecture Decision Records — Secure Multi-Tenant IAM Platform

Team P01-G33 · CS5903 · Repository: https://github.com/krishnateja2314/iam-provider ·
Final tag: `cs5903-final-2026`

This is the single ADR log the final submission guide (§3) asks for. It has one record per material
architecture, framework, security-model, data-model, deployment or methodology decision.

**Documentation date.** This consolidated log was written on **16 November 2026**. Each record's
*decision date* comes from the weekly reports and the git history, and its evidence links point to
that history. No record is backdated. Four records were already kept as separate files and remain
the detailed versions: [`docs/adr/ADR-001`](adr/ADR-001-identity-provider.md) (Keycloak),
[`ADR-002`](adr/ADR-002-authorization-engine.md) (Casbin), [`ADR-003`](adr/ADR-003-service-principals.md)
(AG01) and [`ADR-004`](adr/ADR-004-delegated-agents.md) (AG02). Their numbers below differ because
this log is in decision order; the mapping is given in each record.

| ID | Title | Decided | Status |
|---|---|---|---|
| [ADR-001](#adr-001--modular-monolith-instead-of-eight-microservices) | Modular monolith instead of eight microservices | 2026-09-24 (W1) | Accepted; supersedes the Week 0 plan |
| [ADR-002](#adr-002--reuse-keycloak-for-authentication) | Reuse Keycloak for authentication | 2026-09-24, revised 2026-10-02 | Accepted |
| [ADR-003](#adr-003--casbin-with-application-owned-tenant-boundaries) | Casbin with application-owned tenant boundaries | 2026-09-24, revised 2026-10-02 | Accepted |
| [ADR-004](#adr-004--identity-keyed-by-issuer-and-subject-never-by-email) | Identity keyed by issuer + subject, never by email | 2026-09-24 | Accepted |
| [ADR-005](#adr-005--uncached-introspection-on-every-request-fail-closed) | Uncached introspection on every request, fail closed | 2026-10-02, hardened 2026-10-10 / 10-31 | Accepted |
| [ADR-006](#adr-006--shared-database-with-tenant-ids-and-database-enforced-integrity) | Shared database with tenant IDs and DB-enforced integrity | 2026-09-24 | Accepted |
| [ADR-007](#adr-007--audit-event-in-the-same-transaction-as-the-change) | Audit event in the same transaction as the change | 2026-09-24 | Accepted |
| [ADR-008](#adr-008--minimal-provisioning-slice-instead-of-full-scim) | Minimal provisioning slice instead of full SCIM | 2026-09-24, extended 2026-10-31 | Accepted |
| [ADR-009](#adr-009--responsive-browser-mobile-client-instead-of-a-native-app) | Responsive browser "mobile" client, not a native app | 2026-10-02 (frozen 10-10) | Accepted |
| [ADR-010](#adr-010--local-docker-compose-deployment-with-pinned-images) | Local Docker Compose deployment with pinned images | 2026-10-02 | Accepted |
| [ADR-011](#adr-011--methodology-reaffirmation-and-protocol-freeze-mandatory-record) | **Methodology reaffirmation and protocol freeze (mandatory 9 Oct record)** | 2026-10-10 (one day late) | Reaffirmed |
| [ADR-012](#adr-012--evidence-methodology-clean-clone-runs-and-a-mutation-runner) | Evidence methodology: clean-clone runs + mutation runner | 2026-10-31 (W4) | Accepted; supersedes the W3 script |
| [ADR-013](#adr-013--agents-as-application-service-principals-ag01) | Agents as application service principals (AG01) | 2026-11-07 (W5) | Accepted |
| [ADR-014](#adr-014--user-delegated-agents-through-a-delegation-record-ag02) | User-delegated agents through a delegation record (AG02) | 2026-11-14 | Accepted |

---

## ADR-001 — Modular monolith instead of eight microservices

**Date, status & scope.** Decided 2026-09-24 (Week 1 design report, after the Week 0 review). Accepted.
Supersedes the Week 0 proposal (eight separately deployed services). Affects all milestones M1–M7 and
the folder layout `backend/src/modules/*`.

**Context & decision drivers.** The Week 0 proposal had eight services: authentication (with our own
OIDC server), user/profile, organization, authorization (Zanzibar-style), session/device, SCIM,
consent/audit and agent delegation. The mentor's review was about size, not about the problem. The
eight-week schedule would have gone into networking, deployment and distributed transactions instead
of proving security properties. Drivers: an eight-week budget for a two-person team; an atomic
"mutation + audit event" (invariant 9); clear module boundaries; testability against one real database.

**Options considered.**

| Criterion | Microservices (W0 plan) | Traditional monolith | Modular monolith |
|---|---|---|---|
| Development effort | High | Low | Medium |
| Module separation | Strong | Weak | Strong |
| Deployment effort | High | Low | Low |
| Atomic mutation + audit | Hard (distributed) | Easy | Easy |
| Eight-week risk | High | Low | Low–medium |
| Later extraction to services | Natural | Hard | Natural |

**Decision & rationale.** One Fastify process, one PostgreSQL database, with modules kept as separate
folders (`auth`, `user`, `organization`, `authorization`, `learning-resource`, `provisioning`, `audit`,
`service-principal`, `delegation`). This is a *judgment* based on effort and risk, not a measurement.
It keeps the logical separation of the Week 0 design and makes one ACID transaction available for
the change and its audit row.

**Consequences & trade-offs.** No network hops between modules, and real transactions. All modules
share one deployment and one database (blast radius). No independent scaling. Extracting a module
later needs an API contract and an outbox for audit. The milestone list did not change.

**Evidence & validation.** Week 1 design report (`week1_design_report.tex`); first running system
`0d232ec` (2026-10-02, 159 tests passed); transactional audit tests in `backend/tests/security/t10-audit.test.ts`.

**Revisit trigger.** A module needs to scale or deploy on its own (for example, more than about 10×
the authorization decision load of the other modules), or a second team takes ownership of a module.

---

## ADR-002 — Reuse Keycloak for authentication

*Detailed record: [`docs/adr/ADR-001-identity-provider.md`](adr/ADR-001-identity-provider.md).*

**Date, status & scope.** Decided 2026-09-24 (W1). Revised 2026-10-02: pinned to Keycloak **26.8.0**
instead of the obsolete 24.0.5, with a database-backed upgrade. Accepted. Affects M2, M3, AG01 and AG02.

**Context & decision drivers.** Writing our own OIDC server would be a separate security project:
password hashing, login pages, brute-force protection, key rotation, refresh rotation and federation.
Drivers: standards conformance (OIDC Core, RFC 9700 PKCE S256); enterprise brokering for M2;
configuration that can be reproduced from the repository; one container; no licence cost.

**Options considered.** (1) Our own OIDC server (the W0 plan). (2) Keycloak. (3) Authentik, Ory or
Zitadel. (4) A hosted provider (Auth0, Okta, Entra ID).

**Decision & rationale.** Keycloak. It is open source (Apache-2.0), runs in one container and imports
realms from JSON, so the whole provider configuration lives in `infrastructure/keycloak/`. It
supports authorization code + PKCE, client credentials, introspection and identity brokering.
Authentik and the others were viable but gave no required feature advantage. A hosted provider would
make the evaluator depend on our account and would not reproduce offline. The backend never sees a
password.

**Consequences & trade-offs.** `--import-realm` skips existing realms, so configuration changes need
`scripts/configure-keycloak.mjs` (a non-destructive updater). Introspection is restricted to the
token's audience, so the backend introspects with its own confidential client. The `start-dev` mode
and HTTP in the lab need hardening before production.

**Evidence & validation.** Browser proof `scripts/verify-pkce.mjs`: 11/11 on two hosts
([`docs/evidence/2026-11-14/clean-pkce.log`](evidence/2026-11-14/clean-pkce.log),
[`pkce-127.0.0.1.log`](evidence/2026-11-14/pkce-127.0.0.1.log)). Live lifecycle tests: 21, of which 6 live.

**Revisit trigger.** A required feature Keycloak cannot provide (for example SAML to a real corporate
IdP with signed-assertion constraints), a critical unpatched CVE in the pinned major version, or a
provider round trip p50 above 20 ms on the reference machine.

---

## ADR-003 — Casbin with application-owned tenant boundaries

*Detailed record: [`docs/adr/ADR-002-authorization-engine.md`](adr/ADR-002-authorization-engine.md).*

**Date, status & scope.** Decided 2026-09-24 (W1). Revised 2026-10-02 (Casbin 5.51.1, deny-overrides
effect). Accepted. Affects M4 and M7.

**Context & decision drivers.** M4 needs RBAC + ABAC (published/unpublished) + ReBAC (instructor
teaches course, learner owns submission), evaluated over at least 40 scenarios. Roles must take
effect on the next request (no stale roles in tokens), and explicit denies must win.

**Options considered.** (1) Keycloak Authorization Services. (2) Hand-written permission functions.
(3) An external policy or relationship service (OPA, SpiceDB, OpenFGA). (4) Casbin over facts
stored in our database.

**Decision & rationale.** Casbin 5.51.1 with the PERM effect
`some(allow) && !some(deny)`. Memberships, roles, teaching assignments and tenant `policy_rules` stay
in PostgreSQL and are re-read for every decision. Tenant isolation and relationship rules are hard
boundaries in application code, checked *before* Casbin. Option 1 would mean synchronising our tenant
facts into a second model. Option 2 would scatter effect precedence across handlers. Option 3 adds a
service and a synchronisation problem that this modular monolith does not need.

**Consequences & trade-offs.** No permission cache, so there is no cache to invalidate. The cost is
one fresh enforcer and database reads per decision; no performance target is claimed. A policy allow
cannot bypass a hard boundary. There is no policy delete API.

**Evidence & validation.** `backend/tests/security/t05-t08-authorization.test.ts`: 59 cases (target 40).
Mutation M7 (deny precedence) killed
([`docs/evidence/2026-11-14/clean-mutation.log`](evidence/2026-11-14/clean-mutation.log)).

**Revisit trigger.** More than about 10⁴ relationship tuples per tenant, or an authorization p95 above
50 ms on the reference workload. Either would favour a Zanzibar-style store.

---

## ADR-004 — Identity keyed by issuer and subject, never by email

**Date, status & scope.** Decided 2026-09-24 (W1). Accepted. Affects M1, M2 and invariants 2–3.

**Context & decision drivers.** Many apps merge accounts with matching emails. That allows account
takeover through recycled, changed or unverified addresses, especially once enterprise federation is
added (M2).

**Options considered.** (1) Merge by verified email. (2) Key by `(issuer, subject)` and link explicitly.

**Decision & rationale.** `authentication_identities(issuer, subject)` is unique and maps to one
global user. Users are created just-in-time with no email merge. The enterprise broker links to
platform Bob only through an explicit, preconfigured federated link.

**Consequences & trade-offs.** A user who signs in through two providers gets two accounts until an
administrator links them. That is safer, but less convenient.

**Evidence & validation.** `t01-t02-identity-membership.test.ts` (12 concurrent first logins create
one user; no email merge); enterprise broker login in the browser proof.

**Revisit trigger.** A product requirement for self-service account linking. It would need a proof of
control over both identities, never email equality.

---

## ADR-005 — Uncached introspection on every request, fail closed

**Date, status & scope.** Decided 2026-10-02 (W2). Hardened on 2026-10-10 (default-on, cannot be
disabled in production) and on 2026-10-31 (`5e4367a`: fatal startup check; provider outage → 503).
Accepted. Affects M3, M7 and invariants 5 and 8.

**Context & decision drivers.** A signed JWT stays mathematically valid after logout. "Trust the token
until it expires" (shortcut 4) means logout does not log anyone out: user access tokens live 300 s.
The mentor's Week 2 review found that introspection could be switched off by a flag.

**Options considered.** (1) Baseline **B0: JWT-only** (signature, issuer, audience, expiry, `typ`).
(2) JWT plus introspection with a positive cache of a few seconds. (3) JWT plus *uncached*
introspection, refusing with 503 when the provider is down. (4) Very short tokens without introspection.

**Decision & rationale.** Option 3. Correctness of revocation is a functional requirement, and
latency is not graded. *Measured* (experiment E1, `evaluation/`, 16 Nov 2026): B0 still accepted the
token on the first request after provider logout, admin logout-all and agent disable (5 of 5 trials
each). It kept accepting a disabled agent's token until expiry: median 59.4 s of the 60 s lifetime,
298 of 313 requests accepted. Our API returned 401 on the first request in all 15 trials (median 22,
13 and 7 ms after the call) and accepted 0 requests afterwards. The cost is about 3.3 ms per request
for introspection (p50), against 0.15 ms for local JWT verification. *Judgment:* we accept that cost.

**Consequences & trade-offs.** One provider round trip per request, about a third of an agent request
(p50 3.3 of 9.3 ms). If Keycloak is unavailable the API is unavailable (503, never allow). Password
reset alone does not revoke (provider behaviour, measured), so incident response must call logout-all.

**Evidence & validation.** `session-lifecycle.test.ts` (6 live); `startup-config.test.ts`; mutations M5,
M6; latency [`docs/evidence/2026-11-14/latency.log`](evidence/2026-11-14/latency.log); baseline E1
[`evaluation/results/2026-11-16/`](../evaluation/results/2026-11-16/).

**Revisit trigger.** A requirement above roughly 1,000 requests/s per provider node, or introspection
p95 above 25 ms. Then consider a short positive cache with a documented revocation delay, or
back-channel logout events.

---

## ADR-006 — Shared database with tenant IDs and database-enforced integrity

**Date, status & scope.** Decided 2026-09-24 (W1). Accepted. Affects M1, M4, M5 and invariant 1.

**Context & decision drivers.** Tenant isolation is the core security property. Provisioning (M5) must
be simple and transactional.

**Options considered.** (1) Shared tables with an `organization_id` column. (2) A schema per tenant.
(3) A database per tenant.

**Decision & rationale.** Option 1. It is the simplest to provision and migrate. It also lets the
database enforce cross-tenant integrity: composite foreign keys tie submissions to courses of the
same organization, triggers reject cross-tenant role and teaching links, quota triggers lock the
organization row, and the delegation FK to `memberships(user_id, organization_id)` does the same for
AG02.

**Consequences & trade-offs.** Every query must filter on `organization_id`. A forgotten filter is a
cross-tenant leak. We mitigate it with tests that use *real* foreign IDs and with mutation M3. There is
no per-tenant backup or restore.

**Evidence & validation.** `api.test.ts` (real foreign submission, third tenant, ID substitution → 404);
mutation M3 killed; migrations `backend/src/db/migrations/001`–`005`.

**Revisit trigger.** A tenant with a data-residency or dedicated-backup requirement, or more than about
1,000 tenants with noisy-neighbour effects.

---

## ADR-007 — Audit event in the same transaction as the change

**Date, status & scope.** Decided 2026-09-24 (W1). Accepted. Affects M6 and invariant 9.

**Context & decision drivers.** Shortcut 5: audit as an afterthought that can silently fail.

**Options considered.** (1) Log lines from a logger. (2) An asynchronous audit queue. (3) An audit row
inserted in the same PostgreSQL transaction as the mutation.

**Decision & rationale.** Option 3. If the audit insert fails, the mutation rolls back. Remote
provider revocations cannot join a database transaction, so they are logged as separate *request*
and *complete* events.

**Consequences & trade-offs.** The audit trail is complete for local mutations but not tamper-proof:
an ordinary table with no hash chain. Allow decisions are audited by routes, not by every internal
`authorize()` call.

**Evidence & validation.** `t10-audit.test.ts` (rollback when audit fails); audit assertions in
`delegation.test.ts` and `service-principal.test.ts`.

**Revisit trigger.** A compliance requirement for immutable audit. Then add a hash chain or a
write-once external sink.

---

## ADR-008 — Minimal provisioning slice instead of full SCIM

**Date, status & scope.** Decided 2026-09-24 (W1). Extended on 2026-10-31 (`ece833d`, tenant
email-domain and SSO association after the Week 3 review). Accepted. Affects M5.

**Context & decision drivers.** Full SCIM 2.0 (`/Users`, `/Groups`, filtering, PATCH semantics) is a
project of its own. M5 requires idempotent organization creation, admin bootstrap, quotas and
suspend/reactivate.

**Options considered.** (1) Full SCIM 2.0. (2) A minimal, transactional, idempotent provisioning API.

**Decision & rationale.** Option 2: `POST /api/v1/organizations` with an idempotency key, the admin
bootstrap, quotas, suspend/reactivate and an optional `sso: {emailDomain, identityProviderAlias}`, all
in one transaction. `GET /api/v1/sso/discover` returns the broker alias for `kc_idp_hint`.

**Consequences & trade-offs.** An enterprise cannot push joiners and leavers automatically. Domains
are not DNS-verified. Full SCIM remains future work and is stated as such.

**Evidence & validation.** `provisioning-privacy.test.ts` (9) and `tenant-sso.test.ts` (10, 3 live).

**Revisit trigger.** The first real enterprise customer whose IdP needs SCIM push.

---

## ADR-009 — Responsive browser "mobile" client instead of a native app

**Date, status & scope.** Decided 2026-10-02 (W2) and written into the frozen protocol on 2026-10-10
(criterion 5). Accepted. Affects M2.

**Context & decision drivers.** M2 asks for sign-in on web and mobile. A native app needs platform
toolchains, app links and secure storage. That is outside the security focus and the schedule.

**Options considered.** (1) Native Android/iOS apps. (2) A separate public OIDC client (`iam-mobile`)
with its own redirect URI and a mobile-style responsive page, tested on a physical phone.

**Decision & rationale.** Option 2. It exercises the same protocol properties (a separate public
client, PKCE S256, its own redirect) and was run on a real Android phone on 2026-11-07.

**Consequences & trade-offs.** No native secure storage or device attestation. Over plain HTTP the
phone needs a Chrome secure-origin flag, because PKCE uses `crypto.subtle`. iOS was not tested.

**Evidence & validation.** [`docs/evidence/2026-11-07/phone-run.md`](evidence/2026-11-07/phone-run.md);
mobile login in the browser proof.

**Revisit trigger.** A requirement for offline use, push notifications or hardware-backed keys.

---

## ADR-010 — Local Docker Compose deployment with pinned images

**Date, status & scope.** Decided 2026-10-02 (W2). Accepted. Affects reproducibility for all milestones.

**Context & decision drivers.** Evaluators must be able to start everything from a clean checkout
without hidden local state (guide §4).

**Options considered.** (1) Manual installation of Node, PostgreSQL and Keycloak. (2) A cloud
deployment. (3) Docker Compose with pinned images, loopback-only ports and private databases.

**Decision & rationale.** Option 3. Images are pinned to `keycloak:26.8.0`, `postgres:16.15-alpine`
and `node:24.21.0-alpine`. The backend uses `npm ci` from the lockfile. Migrations and seeding are
idempotent. Databases have no host port. `IAM_PUBLIC_HOST` changes the browser-facing host without
any source change.

**Consequences & trade-offs.** This is an HTTP synthetic lab with public development credentials. It
is not a production deployment. Docker Desktop port forwarding adds about 15 ms per request from the
host, so latency is measured inside the container.

**Evidence & validation.** Clean clone with new volumes, 2026-11-14: all 5 services healthy in 68 s
([`clean-up.log`](evidence/2026-11-14/clean-up.log)); `scripts/verify-client-config.mjs` 9/9.

**Revisit trigger.** A real deployment target (TLS, managed secrets, horizontal scaling).

---

## ADR-011 — Methodology reaffirmation and protocol freeze (mandatory record)

**Date, status & scope.** The decision document `docs/evaluation-protocol.md` is dated and was first
committed on **10 October 2026, 21:35 IST** (`f68add3`). The deadline was **9 October 2026, 11:59 PM
IST**. **Status: approach reaffirmed, not changed. The freeze was one day late.** No mentor-approved
freeze exists from before the deadline. This record was written on 16 November 2026 and does not
backdate anything. Affects all milestones and the frozen acceptance tests.

**Context & decision drivers.** The Week 2 review (W2-FB004) asked us to freeze the evaluation protocol
before Week 3. By 9 October the methodology had been stable since the Week 1 design: modular
monolith, Keycloak, Casbin over database facts, tests written with each milestone, and Docker Compose.

**Options considered.** (1) Reaffirm the Week 1 methodology and freeze the acceptance criteria.
(2) Change the approach, for example back to microservices or to Keycloak Authorization Services.
Nothing in the Week 2 evidence argued for a change. All review findings were defects *inside* the
approach: an introspection flag, tenant guards that were not visibly central, hard-coded constants,
combined assertions, and tests not yet shown to fail.

**Decision & rationale.** Option 1. The criteria frozen on 10 October are:
1. a clean clone starts with `docker compose up -d --build`;
2. active membership is checked on every request, and `X-Organization-ID` substitution exposes nothing;
3. provider lifecycle: password reset alone does not revoke (logout-all is required), refresh replay
   kills the family, and introspection cannot be disabled in production (fail closed);
4. provisioning atomicity: organization, role and audit in one transaction;
5. the mobile client is a responsive browser interface, not a native app;
6. any performance optimisation is measured against a frozen baseline, and introspection may not be
   disabled to gain speed.

**Consequences & trade-offs.** The W2-FB004 timeliness criterion is **not met**, and we say so in the
protocol's timeline note, the Week 4 responses and the final report. The criteria text has not been
edited since 10 October. Later work tightened the implementation to meet them, for example the fatal
startup check in `5e4367a`. There was no later fundamental change of approach. AG01 and AG02 are
extensions inside the Week 1 design, not methodology changes.

**Evidence & validation.** `git show f68add3 -- docs/evaluation-protocol.md`; [`docs/evaluation-protocol.md`](evaluation-protocol.md);
[`docs/mentor-responses.md`](mentor-responses.md) (Week 3, answer 5).

**Revisit trigger.** Any proposal to change a frozen criterion needs documented mentor approval first.

---

## ADR-012 — Evidence methodology: clean-clone runs and a mutation runner

**Date, status & scope.** Decided 2026-10-31 (Week 4, after the Week 3 review). Accepted. Supersedes the
Week 3 `verify-test-independence` script, which reported success on any error. This is a change to
*how results are verified*. The approach and the acceptance criteria did not change. Affects M7 and
every reported number.

**Context & decision drivers.** The mentor reran our code and found evidence weaker than claimed. A
regression (consent withdrawal while suspended) was hidden behind a "159 passed" that came from an
older revision. The mutation script reported success with the database stopped. One adversarial test
used an ID that could never match.

**Options considered.** (1) Keep running tests in the development checkout and report totals.
(2) Run a fresh `git clone` of a named commit with new Docker volumes, and add a mutation runner
that has an explicit *inconclusive* outcome.

**Decision & rationale.** Option 2. Every reported number names a revision and a date and comes from a
clean clone. `scripts/verify-test-independence.mjs` checks that the container source matches the
checkout, requires a passing baseline, applies one mutation at a time in a disposable copy, requires
the *named* tests to fail with assertion errors, and exits 2 (inconclusive) on crashes or a stopped
database. It never edits the working tree.

**Consequences & trade-offs.** A full run takes longer, including a 5-minute database-down control.
Results from older revisions are kept only as history.

**Evidence & validation.** 7/7 mutations killed (W4) → 11/11 (W5) → **15/15** (final), with the
database-down control giving exit 2 each time
([`mutation-db-down.log`](evidence/2026-11-14/mutation-db-down.log), [`mutation.json`](evidence/2026-11-14/mutation.json)).

**Revisit trigger.** CI becomes available. Then run the same commands on every push and publish the logs.

---

## ADR-013 — Agents as application service principals (AG01)

*Detailed record: [`docs/adr/ADR-003-service-principals.md`](adr/ADR-003-service-principals.md).*

**Date, status & scope.** Decided 2026-11-07 (W5, `fde2efd`). Accepted. Affects AG01, token validation
and route classes.

**Context & decision drivers.** A reporting agent must call the API without a human, hold exactly one
action in one tenant, and be audited as a program. Reusing the human path would create a fake user
whose membership roles could silently widen what the agent can do.

**Options considered.** (1) Give the agent a user account and a membership with a role. (2) A separate
principal kind: a client-credentials token with `principal_kind=service`, a registry, and explicit
`(tenant, resource, action)` grants.

**Decision & rationale.** Option 2. No `users` or `memberships` row is ever created for a service. Casbin
roles are never consulted. The grant must match exactly. Human-only routes refuse service tokens (403).

**Consequences & trade-offs.** Grants are managed in the database; there is no grant API. Re-enabling a
disabled client revives unexpired tokens (an observed Keycloak behaviour), so the registry status
is the reliable off switch.

**Evidence & validation.** `service-principal.test.ts`: 30 (7 live); mutations M8–M11 killed;
[`clean-ag01.log`](evidence/2026-11-14/clean-ag01.log).

**Revisit trigger.** More than a handful of agents per tenant, which would need a grant-management API
with audit.

---

## ADR-014 — User-delegated agents through a delegation record (AG02)

*Detailed record: [`docs/adr/ADR-004-delegated-agents.md`](adr/ADR-004-delegated-agents.md).*

**Date, status & scope.** Decided 2026-11-14 (`e13f019`). Accepted. Implements Week 1 invariant 7
(*an agent never has more effective permission than its delegating user*) and scenarios 13–14.

**Context & decision drivers.** An agent acting for a user must be bounded by the user's *current*
permission, scoped, bound to one tenant, expiring and revocable on the next request.

**Options considered.** (1) OAuth 2.0 Token Exchange (RFC 8693) with an `act` claim. (2) Copying the
user's roles onto the agent. (3) A delegation record `(agent, user, tenant, scopes, expiry, revoked)`,
re-read on every decision, with the request evaluated *as the user*.

**Decision & rationale.** Option 3. Effective permission = user permission ∩ delegated scope ∩ tenant.
Option 2 breaks invariant 7 when the user loses a role. Option 1 is the standard wire format, but the
backend would still need the record for scopes and revocation, and live revocation would depend on
provider token state.

**Consequences & trade-offs.** It uses a custom header (`X-Delegation-ID`) instead of a standard token.
One extra indexed lookup per decision. Administrative scopes are never delegable. There is no admin
view of other users' delegations.

**Evidence & validation.** `delegation.test.ts`: 26 (4 live); mutations M12–M15 killed; browser step 5;
revocation → 401 on the first request (17 ms);
[`clean-ag02.log`](evidence/2026-11-14/clean-ag02.log).

**Revisit trigger.** Interoperability with third-party agents that present RFC 8693 tokens. Then issue
exchanged tokens and keep the record as the revocation source.
