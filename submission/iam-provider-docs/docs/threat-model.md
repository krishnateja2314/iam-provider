# Threat Model and Security Invariants

Final execution evidence is in [verification-evidence.md](verification-evidence.md):
159 tests passed including live provider cases, and real browser proof passed.
Password reset alone kept the existing session active; final logout/revoke observations
were 62/65/38 ms through the first denied request. These samples are not an SLA.

## Scope and Evidence

Source review: 2026-10-02, current modular-monolith implementation with Keycloak **26.8.0**, Casbin **5.51.1**, Fastify 5 and PostgreSQL 16 (Compose now pins **16.15**; interim execution used the earlier 16.3 deployment). This is a synthetic local lab, not a production security certification. Test files are evidence of intended checks; execution results must be recorded in `traceability-matrix.md`. The earlier Keycloak 24, five-second expiration tolerance, and no-introspection descriptions no longer describe the supplied Compose configuration.

## Assets, Actors and Trust Boundaries

Assets include credentials and refresh/access tokens, tenant memberships/roles, learning resources/submissions/grades, purpose-specific profiles and consent, provider sessions, bootstrap privileges and audit history.

Actors include an unauthenticated attacker, a malicious authenticated learner/instructor, a curious tenant admin, a token thief, a compromised browser, and an operator with provider/database credentials. The last two cannot be made harmless merely by checking API roles.

The boundaries are browser to Keycloak, browser to API, API to provider JWKS/introspection/Admin API, API to application PostgreSQL, and operator/configuration tools to both stores. A brokered enterprise identity arrives through the platform realm; the API still trusts only its configured platform issuer/audience, not an arbitrary upstream enterprise token.

## Threat Register

| Threat | Current Mitigation | Residual Risk / Evidence Target |
|---|---|---|
| Forged token or algorithm confusion | Production JOSE verifier, trusted JWKS, RS256 only, required issuer/audience/expiration/subject | Protect configured issuer/JWKS and transport; T04 signed fixtures include same-key-ID wrong signature. |
| ID token used as API credential | Signed payload `typ` must equal `Bearer`; client uses access token for API | Client ID-token validation is a different concern; T03/T04. |
| Malformed claims used to construct authorization context | Nonempty subject/audience shapes; typed email, verification, roles, broker/session strings; consistent sid/session_state; optional azp allowlist | azp allowlist is conditional configuration, not universally enabled; T04. |
| Expired or future token claims | JOSE exp/nbf checks with zero clock tolerance; optional iat sanity including limited future allowance | Hosts need correct clocks; T09. |
| Stolen unexpired access token after logout | Compose enables uncached introspection on every authentication; requires active=true and matching verified subject/session | Behavior depends on provider state visibility, configuration and network; T11 live evidence required. JWT-only mode lacks this guarantee. |
| Authorization-code interception / login CSRF | S256 PKCE, random state and nonce, short-lived one-use transaction, callback issuer check when supplied | Browser XSS can act as the user; wrong-verifier/state/broker checks require real browser evidence; T03/T11. |
| Refresh replay | Provider rotation/reuse settings; client replaces tokens after refresh | API does not accept or manage refresh tokens; T11 must verify pinned-provider behavior. |
| Tenant selector manipulation / IDOR | Header is UUID input only; membership/org status validation; tenant-bound resource lookups | UUID secrecy is not security; include mismatched header/resource and foreign submission tests, T05. |
| Role escalation | Current tenant role assignments read from DB; Casbin deny-overrides/default deny | Platform role is separate; tenant admin policy insertion is powerful within allowed route schema; T06/T13. |
| Instructor reading/grading unrelated work | Teaching relationship for individual read/grade and SQL-filtered submission lists | Stored teaching labels are not hardware or person assurance; T07. |
| Stale membership/policy after suspension or removal | No permission cache; repeated DB facts and fresh enforcer | In-flight requests are not universally reauthorized at commit; T08/T12. |
| Cross-tenant relationship corruption | Composite tenant FKs for membership roles, teaching and submissions; unique identity/membership keys | Profiles/consents have simpler FKs and rely on service checks; direct DB admin remains trusted; T01/T02/T12. |
| Bootstrap retry duplicates / partial organization | Actor-scoped advisory lock + payload hash + ledger; bootstrap and audit one transaction | Provisioning service trusts its caller to establish platform privilege; current HTTP route does so, T12. |
| Concurrent quota bypass | Organization-row lock/count triggers; service transaction locking | Not rate limiting; no performance/load claim, T12. |
| Excess profile disclosure / stale consent | Explicit service output allowlist, purpose filter, latest sequence and repeatable-read view | HTTP requests userId/displayName/bio; service withholds bio without current grant. No arbitrary identity fields; T12/T13. |
| Audit evasion / secret logging | Required route audit; mutation audit in same transaction; logger redacts authorization/cookies/body; bounded fields | No immutable external sink, retention policy or cryptographic proof; not every arbitrary internal call audits, T10. |
| Provider-admin credential theft | Separate confidential backend introspection and provider-admin credentials; bounded provider-admin roles | manage-users is still powerful. Dev secrets/start-dev/HTTP must not be deployed unchanged. |
| Resource exhaustion | 32 KiB request body cap, route field/grade enums and limits, list limits, five-second provider request timeout | No API rate limiter, pagination protocol or measured concurrency budget. |

## Security Invariants and Their Actual Boundaries

1. **Authenticated identity is verified before mapping.** The API resolves `(issuer, subject)` only after cryptographic/claim checks and configured introspection. Email alone cannot create a link to an existing user.
2. **Tenant selection is never proof of access.** `X-Organization-ID` is supplied by an untrusted caller. Normal tenant routes require active membership and active organization; privileged platform routes explicitly do not use tenant access as their bootstrap authority. Consent is an intentional exception: its authenticated service checks membership, requires active state for grants, and permits an existing suspended member to withdraw.
3. **Tenant permission is application-owned.** Tenant roles, policy rows, teaching and ownership are database facts, not trusted role claims from a client request. Validated provider `platform-admin` is used only for explicit platform operations.
4. **Resource identifiers are tenant-bound.** Individual lookups pair ID with organization; lists include tenant and ownership/teaching filters as appropriate. A foreign ID returns a nonrevealing resource-not-found/denial rather than its contents.
5. **Hard boundaries precede policy allows.** An explicit matching Casbin deny overrides any role's allow. Absence of allow or an evaluation/storage exception denies. Policy rows cannot reactivate a tenant or fabricate a teaching relationship.
6. **Database protects relationship consistency.** Composite FKs bind child rows to the correct organization and protect referenced parent updates. Service checks alone are not the only barrier.
7. **Selected mutations and audit are atomic.** Provisioning, member/resource creation, consent, policy insertion and grading put mutation and allow audit in one transaction. Audit failure must roll back that mutation. Do not generalize this to remote provider operations or all identity creation.
8. **No bearer secrets belong in reports/logs.** API logging redacts credential-bearing fields; audit stores decisions and references, not token contents. Verification scripts deliberately avoid traces/HARs/token export. Arbitrary JSON metadata or future logging code still needs review.
9. **Session actions are caller-owned.** Session listing uses authenticated provider subject; targeted revoke first checks the session is in that user's provider list. Logout-all resets that subject only. Provider session ownership is not a hardware-device claim.
10. **Profile disclosure is projected, not serialized wholesale.** Service supports only userId/displayName/bio; bio requires requested field and current profile-sharing grant. Identity email/provider metadata/audit data are not profile fields. Analytics consent is not profile-sharing consent.

## Session and Revocation Semantics

Offline JWT verification establishes integrity and expiration, not whether a session is currently active. Compose sets `KEYCLOAK_INTROSPECTION=true`; the validator first checks JWT, then asks the provider on every request without an active-state cache. A missing session reference, inactive response, subject/session mismatch, timeout, non-OK HTTP response or malformed JSON rejects authentication. The current implementation may classify these provider failures as an authentication rejection rather than a 503; it nevertheless does not allow access.

`sid` or `session_state` is validated and held in request context. Application PostgreSQL does not persist a local device/session record. `GET /sessions` queries provider-managed state and returns references, timestamps, IP and client context. Targeted deletion and logout-all have pre-side-effect audit and a completion audit. A remote provider deletion cannot join a PostgreSQL transaction: success at the provider followed by failed completion audit can leave a revoked session and an error response. A request audit alone is not proof of provider completion.

With introspection disabled, an already-issued valid access token can remain usable until expiry after provider logout. With it enabled, rejection depends on the provider actually reporting it inactive; do not promise zero propagation time across all deployments, offline tokens, upstream SSO, or in-flight requests. `resetProviderSessions` means provider-session invalidation, **not** password reset or global upstream-enterprise logout. Updated live tests also exercise genuine provider password replacement separately, recording old/new credential acceptance and already-issued token state. Refresh reuse tests observe successor refresh/access behavior before explicit logout; reuse rejection alone does not prove whole-family revocation. Measured rejection delay in the live suite is local evidence, not a universal SLA.

## Known Gaps at Source Review

- Consent withdrawal deliberately bypasses the ordinary active-only tenant hook/Casbin path and relies on service ownership checks. This exception needs explicit HTTP tests, not only service tests.
- The profile route requests the fixed userId/displayName/bio allowlist; tests must verify the public route omits bio after withdrawal and never emits identity metadata. Service-level projection tests are not automatically HTTP evidence.
- Authorization fact reads and later mutation commits are not universally serialized together. Role removal/suspension during an in-flight operation needs an explicit consistency policy and adversarial tests beyond next-request checks.
- Development HTTP, provider `start-dev`, sample passwords/secrets and a browser mobile demo are not production hardening or native-app secure storage.
- Optional service principals, agent delegation, tenant-specific real enterprise onboarding, hardware device attestation and performance benchmarks are **NOT IMPLEMENTED**.

## Verification Discipline

Use `traceability-matrix.md` to distinguish signed synthetic-token tests, real PostgreSQL tests, injected HTTP tests and real Keycloak/browser flows. Record date, command, environment/configuration, pass/fail/skip counts and safe output. Never substitute decoding a JWT, an HTTP health check, or a passing parser test for real PKCE, revocation or broker lifecycle evidence.
