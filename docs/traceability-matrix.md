# Requirements-to-Test Traceability Matrix

## Actual Evidence

Final complete execution **2026-10-02T15:56:38Z**: **159 passed, 0 failed, 0 skipped,
7 suites**. Stack: Node24.21.0, PostgreSQL16.15, Keycloak26.8.0, Vitest5.0.3.
Typecheck/build passed; npm audit reported zero vulnerabilities.
[Execution evidence](verification-evidence.md) records commands, measured outcomes,
first-start proof and the failed intermediate checks that were corrected.

```powershell
# Enable the synthetic test-only client first, as in the demo guide.
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test
```

Fixture tests use the production JOSE validator with signed test tokens and real
PostgreSQL. Live tests explicitly enable introspection and call the running API
with real Keycloak tokens. The exec environment does not change the server process.
Without the live flags the normal result is **153 passed, 6 skipped**; skipped does
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
| T12 / M5/M6 | Provisioning retries/conflicts/rollback, admin bootstrap, quotas, suspension/reactivation, purpose consent and permitted fields | 9 grouped real DB provisioning/privacy cases; HTTP consent/profile case | VERIFIED: concurrent same-key retries one org; different payload conflict; quota locks; suspension/reactivation; append-only purpose consent; analytics cannot enable bio; suspended withdrawal200; bio omitted after withdrawal; unknown identity fields excluded. |
| T13 / M4/M7 | At least40 representative policy cases; dynamic policy change and escalation resistance | `t05-t08-authorization.test.ts` | VERIFIED: 59 cases including48 role/resource/action combinations and11 boundaries; admin is not blanket permission; deny-overrides tested across roles. |

## Mechanism and Evidence Boundaries

| Explicit mentor row | Implementation/evidence | Boundary |
|---|---|---|
| Two synthetic organizations | Seed Acme/Globex and HTTP/browser lists | No real identities/orgs used. |
| Web/mobile | Separate public client IDs and redirect pages; both live paths verified | Mobile-style browser, not native Android/iOS. |
| Two authentication mechanisms | Local provider password entered on OIDC page; federated enterprise OIDC broker | No custom authentication server; synthetic upstream is not a real corporate deployment. |
| Domain/SSO setup | Imported enterprise realm and broker/client callback settings; non-destructive updater | No DNS verification, real company domain proof or SAML integration claimed. |
| Administrator bootstrap | Explicit Keycloak platform-admin fixture; atomic tenant admin creation service | Platform role never bypasses resource tenant membership; provider-admin infrastructure is bounded but sensitive. |
| Policy changes | Fresh tenant policy rows each decision; insertion endpoint and dynamic tests | No general policy editor/language or graph platform. |
| Session/refresh lifecycle | Provider-managed with uncached audience-client introspection | API fail closed when provider unavailable; only observed local timing is claimed. |
| Password/account reset | Actual provider reset-password tested separately from logout-all | Password reset alone does not revoke sessions; use logout-all for incident response. |
| Quotas | Organization row locks plus DB triggers; concurrency tests | Counts stored members/resources, not billing or performance limits. |
| Suspension/reactivation | Explicit platform status route and atomic service | Archived orgs cannot simply reactivate; no tenant data bypass. |
| Purpose consent/fields | Append-only latest grant; service and HTTP grant/withdrawal checks | Public userId/displayName minimal; bio needs profile-sharing, not analytics consent. |
| Malformed federation/token claims | Production signed-token shape validation | Explicit provider fixture linking is not email-based application merging. |
| Reproducible startup | New `iam-firststart` volumes/import/migrate/seed/browser proof; isolated153pass6skip | Verified build context subsequently published at github.com/krishnateja2314/iam-provider, source baseline0d232ec; an independent clone-based run has not been performed. |

## Final Evidence Summary

| Check | Actual result |
|---|---|
| Complete backend suite, main stack | 159 PASS /0 FAIL /0 SKIP,15:56:38Z |
| Isolated first-start fixture suite | 153 PASS /0 FAIL /6 SKIP,15:49:54Z |
| Real Edge browser PKCE/broker/tenant/session proof | PASS on main and newly initialized isolated stack |
| Typecheck and Docker production build | PASS |
| npm dependency audit | 0 findings |
| Existing-token revocation local observations | First request401; final operation-to-denial durations62/65/38ms, max65ms over3samples |
| Consent/profile HTTP | PASS for grant/bio projection/suspended withdrawal/omitted bio |

## Deferred Extensions

| Item | Status / required future evidence |
|---|---|
| AG01 application machine identity | NOT IMPLEMENTED; provider infrastructure service account is not an app principal. Add dedicated tenant/action/audience policy and expiry/disablement tests. |
| AG02 user-delegated agent | NOT IMPLEMENTED; require permission intersection, grant expiry/revocation and delegator role-loss tests. |
| Native/hardware device identity | NOT IMPLEMENTED; provider session references are the baseline. |
| Full SCIM | NOT IMPLEMENTED; transactional application provisioning is the approved minimal slice. |
| Optional performance experiment | NOT IMPLEMENTED; no three-run latency/throughput improvement is claimed. |

Test existence, an expected-result table and configuration are not equivalent to
execution evidence. See the dated evidence report for actual outputs and limitations.
