# Requirements-to-Test Traceability Matrix

## Actual Evidence

Current complete execution, revision **`fde2efd`**, from a **clean clone with new volumes**,
**2026-11-07T05:49:38Z**: **227 passed, 0 failed, 0 skipped, 10 files** (including 16 live-provider
cases). Stack: Node 24.21.0, PostgreSQL 16.15, Keycloak 26.8.0, Vitest 5.0.3. Typecheck (source and
tests) and build passed. Mutation check: 11 of 11 killed. Browser proof: 10 of 10 PASS. npm audit:
**0 vulnerabilities** (the 4 W4 advisories and a new `vite` advisory are fixed).
Previous: `42d8a43`, 2026-10-31, 197 passed.
[Execution evidence](verification-evidence.md) has the commands, raw logs, the pre-fix
baseline (`953a0aa`: 160 pass, 1 fail, 6 skip) and the historical 2 Oct record (159 pass on `0d232ec`).

```powershell
# Enable the synthetic test-only client first, as in the demo guide.
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test
```

Fixture tests use the production JOSE validator with signed test tokens and real
PostgreSQL. Live tests explicitly enable introspection and call the running API
with real Keycloak tokens. The exec environment does not change the server process.
Without the live flags the normal result is **188 passed, 9 skipped**; skipped does
not mean passed. Paths below are relative to `backend/`, unless otherwise specified.

## T01-T13

| ID | Acceptance requirement | Test/evidence path | Expected and observed outcome |
|---|---|---|---|
| T01 / M1 | Global user, multiple external identity links, issuer/subject uniqueness, no email merge, concurrent first login | `tests/security/t01-t02-identity-membership.test.ts`; DB cases in `t03-t04-t09-token-validation.test.ts`; independent test issuer links in API setup | VERIFIED: unique identity constraints, distinct users for equal emails, 12 concurrent requests create one identity/user; fixture issuer linking leaves production mapping unchanged. No general account-linking API is claimed. |
| T02 / M1 | Different roles across two orgs; duplicate memberships and cross-tenant role/teaching/submission assignments rejected, including parent moves | Identity/membership suite; `provisioning-privacy.test.ts`; migrations001/002 | VERIFIED: Alice admin in Acme and learner in Globex; real PostgreSQL uniqueness/composite-FK and parent-update denials. |
| T03 / M2 | Authorization code + S256 PKCE login and intended API audience for web/mobile | `scripts/verify-pkce.mjs`; `clients/app.js`; realm public clients | VERIFIED live browser: both local login clients, valid signed tokens/API calls; incorrect verifier rejected400. Mobile is a responsive browser client, not a native app. |
| T04 / M2/M7 | Invalid signature/algorithm/issuer/audience, ID tokens and malformed claims rejected | 41 cases in production-validator suite; browser signed-claim checks | VERIFIED: same-kid wrong-key denial; missing/expired temporal claims, malformed subject/audience/role/session claims and configured azp checks. API requires Bearer access-token type. |
| T05 / M4/M7 | Active member allowed; selected org and resource IDs cannot expose another tenant | Authorization suite, API suite, browser tenant assertions | VERIFIED: published reads/list allowed; wrong tenant membership403; cross-tenant resource404 with no resource returned; SQL list filtering checked. |
| T06 / M4/M7 | Learner cannot perform admin actions; lists stay tenant-filtered | Casbin role matrix, HTTP members/resource/draft tests, browser role switch | VERIFIED: admin allowed only within membership; learner admin403, draft list/read403, published tenant list200. |
| T07 / M4 | Instructor can read/grade only assigned submissions; learner own work | Authorization boundaries; API assigned/unrelated grading/read/list tests | VERIFIED: related course allowed, unrelated denied403, actual grade plus audit committed; invalid grade400. PostgreSQL NUMERIC grades are decimal strings in JSON. |
| T08 / M4/M7 | Inactive memberships/orgs denied; role/policy changes affect later decisions | Authorization role-removal and explicit policy tests; provisioning suspend/reactivate cases | VERIFIED: active/inactive transitions and policy rereads; matching deny overrides allow even across two roles. Already-authorized in-flight work is not cancelled. |
| T09 / M3 | Expired access token denied; distinguish refresh session lifetime | Production-validator temporal cases; live refresh-session expiry case | VERIFIED: expired JWT rejected; test-client session expiration denies refresh and existing access via introspection. Normal demo access lifetime300s differs from short test session. |
| T10 / M6/M7 | Queryable allow/deny audit; no secrets; auth/audit outage fails closed | Audit suite; API correlation-specific real DB audit trigger failure; unavailable DB authorization case; provisioning rollback cases | VERIFIED: required fields/filtering, real unavailable authorization storage denial, grade/bootstrap/member/consent audit failure rollback. Remote provider mutations use request/completion audit, not a fictitious distributed transaction. |
| T11 / M2/M3/M7 | Second enterprise auth path; web/mobile; refresh replay/logout/reset/device/session revocation; malformed claims | Live lifecycle16 cases including6 provider cases; browser local/broker paths; claim suite | VERIFIED: both clients through enterprise broker; logout/revoke/logout-all existing token401; refresh reuse and successor400/access401. Password reset changes credentials but old access remains200 until explicit logout. Device reference is provider session, not attestation. |
| T12 / M5/M6 | Provisioning retries/conflicts/rollback, admin bootstrap, quotas, suspension/reactivation, purpose consent and permitted fields | 9 grouped real DB provisioning/privacy cases; HTTP consent/profile case | VERIFIED: concurrent same-key retries one org; different payload conflict; quota locks; suspension/reactivation; append-only purpose consent; analytics cannot enable bio; suspended withdrawal200; bio omitted after withdrawal; unknown identity fields excluded. **Regression note:** at `953a0aa` the HTTP route blocked suspended withdrawal (403). Fixed in `5e4367a` (`ownMembershipHook`). Organization- and membership-suspension cases, grant denial and foreign-tenant denial were added and pass at `42d8a43`. |
| T13 / M4/M7 | At least40 representative policy cases; dynamic policy change and escalation resistance | `t05-t08-authorization.test.ts` | VERIFIED: 59 cases including48 role/resource/action combinations and11 boundaries; admin is not blanket permission; deny-overrides tested across roles. |

## Mechanism and Evidence Boundaries

| Explicit mentor row | Implementation/evidence | Boundary |
|---|---|---|
| Two synthetic organizations | Seed Acme/Globex and HTTP/browser lists | No real identities/orgs used. |
| Web/mobile | Separate public client IDs and redirect pages; both live paths verified | Mobile-style browser, not native Android/iOS. |
| Two authentication mechanisms | Local provider password entered on OIDC page; federated enterprise OIDC broker | No custom authentication server; synthetic upstream is not a real corporate deployment. |
| Domain/SSO setup | Imported enterprise realm/broker (federation in Keycloak). **Per-tenant association (M5):** migration 003 `organization_sso_configs` (unique domain to one tenant, broker alias), optional `sso` input persisted and audited in the provisioning transaction, `GET /api/v1/sso/discover` returns the alias for Keycloak's standard `kc_idp_hint`. `tests/security/tenant-sso.test.ts` includes a live check that a newly provisioned tenant routes into the enterprise realm | Domains are administrator-asserted: no DNS verification, real company domain proof, SAML or SCIM. Aliases must already exist in the realm (`KEYCLOAK_BROKER_ALIASES`). |
| Startup/outage contract | `src/config.ts` validated before `listen()`; `DependencyError` maps to 503 | `startup-config.test.ts` (subprocess exit 1, no port); exact 503 for provider network/500/503 errors, exact 401 for an inactive token. Introspection may be disabled only with `NODE_ENV=test`. |
| Host configurability | `IAM_PUBLIC_HOST` drives Keycloak hostname, issuer, CORS, client `/config.js` and CSP | Browser proof passed on `127.0.0.1` as an alternate origin. Physical phone on a LAN not recorded. |
| Administrator bootstrap | Explicit Keycloak platform-admin fixture; atomic tenant admin creation service | Platform role never bypasses resource tenant membership; provider-admin infrastructure is bounded but sensitive. |
| Policy changes | Fresh tenant policy rows each decision; insertion endpoint and dynamic tests | No general policy editor/language or graph platform. |
| Session/refresh lifecycle | Provider-managed with uncached audience-client introspection | API fail closed when provider unavailable; only observed local timing is claimed. |
| Password/account reset | Actual provider reset-password tested separately from logout-all | Password reset alone does not revoke sessions; use logout-all for incident response. |
| Quotas | Organization row locks plus DB triggers; concurrency tests | Counts stored members/resources, not billing or performance limits. |
| Suspension/reactivation | Explicit platform status route and atomic service | Archived orgs cannot simply reactivate; no tenant data bypass. |
| Purpose consent/fields | Append-only latest grant; service and HTTP grant/withdrawal checks | Public userId/displayName minimal; bio needs profile-sharing, not analytics consent. |
| Malformed federation/token claims | Production signed-token shape validation | Explicit provider fixture linking is not email-based application merging. |
| Reproducible startup | **Clean `git clone` of `fde2efd`**, `docker compose -p iam-w5clean up -d --build --wait`, new volumes, no `.env`. Full live suite 227/0/0, mutation 11/11, browser 10/10 | Run by the team on its own machine, not an independent third party. |

## Final Evidence Summary

| Check | Actual result |
|---|---|
| Complete suite incl. live, clean clone `fde2efd` | 227 PASS /0 FAIL /0 SKIP, 2026-11-07T05:49:38Z |
| AG01 service principal (`service-principal.test.ts`) | 30 PASS (7 live): Acme list 200, Globex 403, admin 403, expired 401, disabled client 401 (first request), `actor_type='service'` audit |
| Previous complete suite, clean clone `42d8a43` | 197 PASS /0 FAIL /0 SKIP, 2026-10-31T09:18:36Z |
| Pre-fix baseline `953a0aa` (DB, no live) | 160 PASS /1 FAIL /6 SKIP (suspended consent withdrawal) |
| Mutation independence (11 guards) | 11 killed /0 survived /0 inconclusive; DB-down run INCONCLUSIVE exit 2 |
| Real Edge browser PKCE/broker/tenant/session proof | 10/10 PASS on clean stack; 10/10 PASS on alternate origin `127.0.0.1` |
| Typecheck (source + tests) and Docker production build | PASS |
| npm dependency audit | **0 vulnerabilities** at `fde2efd` (W4: 4 advisories; fixed in W5) |
| Existing-token revocation local observations | First request401; 62/52/31/158ms, max158ms over4samples |
| Consent/profile HTTP | PASS: grant/bio projection; withdrawal under org and membership suspension; grant and foreign tenant denied |
| Historical (2 Oct, `0d232ec`) | 159 PASS /0 /0. Not evidence for later revisions |

## Deferred Extensions

| Item | Status / required future evidence |
|---|---|
| AG01 application machine identity | IMPLEMENTED (W5, ADR-003): `iam-agent-reporting` client-credentials client, `principal_kind=service`, registry + exact grant (Acme `learning-resource:list`), human-only routes refuse it, `actor_type='service'` audit. `service-principal.test.ts` (23 fixture + 7 live) and mutations M8-M11. |
| AG02 user-delegated agent | NOT IMPLEMENTED; require permission intersection, grant expiry/revocation and delegator role-loss tests. |
| Native/hardware device identity | NOT IMPLEMENTED; provider session references are the baseline. |
| Full SCIM | NOT IMPLEMENTED; transactional application provisioning is the approved minimal slice. |
| Optional performance experiment | OBSERVED, not optimised: 3 x 200 sequential requests inside the container; agent request p50 6.2-7.2 ms, introspection alone 2.1-2.4 ms, `/health` 0.5-0.7 ms. No throughput or improvement claim. |

Test existence, an expected-result table and configuration are not equivalent to
execution evidence. See the dated evidence report for actual outputs and limitations.
