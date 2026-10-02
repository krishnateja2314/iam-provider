# Execution Evidence - 2026-10-02

## Environment and Scope

Windows host, Docker Desktop Linux containers, Node container 24.21.0-alpine,
Keycloak 26.8.0, PostgreSQL 16.15-alpine, Vitest 5.0.3. Browser proof used installed
Microsoft Edge 154.0.4258.48 through Playwright because Chromium's CDN download timed out.
Application and provider databases remained private to their Docker networks.

These are observed local results, not a production security certification. No
tokens, passwords, cookies, authorization codes, traces or HAR files were exported.

## Final Complete Suite

At 2026-10-02T15:56:38Z, after rebuilding the final source:

```powershell
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test
```

Actual output summary:

```text
tests/integration/api.test.ts                              20 passed
tests/security/session-lifecycle.test.ts                   16 passed
tests/security/provisioning-privacy.test.ts                  9 passed
tests/security/t10-audit.test.ts                             6 passed
tests/security/t03-t04-t09-token-validation.test.ts         41 passed
tests/security/t05-t08-authorization.test.ts                59 passed
tests/security/t01-t02-identity-membership.test.ts            8 passed
Test Files  7 passed (7)
Tests       159 passed (159)
Duration    10.41s
Failed      0
Skipped     0
```

The production API process retained introspection enabled. Fixture tests use
locally signed JOSE tokens; the six live lifecycle cases explicitly enable real
provider introspection and call the running API with provider-issued tokens.
The 59 authorization cases include 48 role/action cases and 11 hard-boundary,
relationship, role-change and deny-precedence cases. Concurrency tests are
correctness checks, not latency benchmarks.

`docker compose exec -T backend npm run typecheck` passed. Docker image build ran
`npm run build` successfully. `docker compose exec -T backend npm audit` reported
`found 0 vulnerabilities`. This is an advisory snapshot, not proof of absence of defects.

## Live Session Outcomes

The final complete suite observed the first existing-token API request after:

| Operation | First request | Measured duration from operation start through denial |
|---|---|---|
| Provider logout | 401 | 62 ms |
| Own-session API revocation | 401 | 65 ms |
| Admin logout-all | 401 | 38 ms |

Maximum observed duration in the final run was **65 ms across three samples**, below the test's
5-second bound. This includes the remote operation and the subsequent request;
it is not a statistical propagation bound or an SLA. Earlier focused and full runs
observed 38/44/27 ms and 55/57/34 ms. Already-authorized in-flight operations may complete.

Actual password-reset evidence:

```json
{"oldCredentialsAccepted":false,"newCredentialsAccepted":true,"previouslyIssuedAccessTokenStatus":200}
```

**Password reset alone does not revoke the existing session** in this configuration.
Incident response must also invoke provider logout-all; do not describe password
replacement as immediate token revocation.

Actual refresh replay evidence, before any explicit logout:

```json
{"reusedRefreshStatus":400,"successorRefreshStatus":400,"successorIssuedAccessTokenStatus":401}
```

The short-session test client also demonstrated refresh-session expiration and
inactive issued access tokens. Its approximately 3-second maximum session is
intentional test configuration, distinct from normal demo access/session lifetimes.

## Real Browser Proof

```powershell
$env:IAM_BROWSER_CHANNEL="msedge"
node scripts/verify-pkce.mjs
```

Final script completed successfully on both the existing stack and a newly created
isolated stack. Observed checks:

- Bounded provider service account cannot mutate realm configuration (403).
- Wrong S256 PKCE verifier is rejected (400).
- Web and mobile-style local login succeed with signed issuer/audience/type/subject/role checks.
- Web and mobile-style enterprise broker login succeed through the separate enterprise realm.
- Alice's tenant selector shows different roles; published resource lists remain tenant-filtered.
- Learner member administration is denied (403); cross-tenant resource ID is not found (404).
- Tenant audit queries contain allow and deny events.
- Session listing excludes a different user; foreign-session deletion is denied without revoking the victim.
- Refresh rotation succeeds; old-token replay is rejected.
- Individual session revocation rejects existing access (401) and refresh (400), preserving other sessions.

## First-Start and Preservation Proof

Existing project databases were retained. Only this project's API/provider/client
services were temporarily paused; unrelated running projects were untouched.
`docker compose -p iam-firststart up -d --build --wait` created separate **new named
volumes**, imported the realms, applied migrations, seeded fixtures, and brought all
five services healthy. Browser proof passed without running the configuration updater.

The isolated database's final suite at 15:49:54Z reported **153 passed, 6 skipped,
0 failed**. The six live cases were intentionally not enabled on that stack; they
passed on the main stack as recorded above. The isolated stack was stopped and
the original project's services were restored healthy. Neither set of volumes was deleted.
This tested first-start behavior from the build context, not a Git clone. The verified
source was subsequently published at https://github.com/krishnateja2314/iam-provider,
source-baseline commit `0d232ecbd567a3482d0ebbc213d39e908e064ee1`. An independent
clone-based verification was not performed as part of that earlier run.

## Failures Found and Corrected During Verification

- Keycloak directory imports required realm-matching filenames.
- Keycloak 26 clients required the basic subject mapper scope; required token claims were not relaxed.
- Lifecycle tests initially used a non-audience introspection client; they now use the backend's credentials.
- Refresh ID tokens may omit nonce. Initial login requires nonce; refresh validates any present nonce and preserves signed subject/issuer/audience.
- Fresh seed still used a legacy consent purpose incompatible with the new constraints; it now starts with denied analytics consent.
- A grading test incorrectly expected a JSON number; PostgreSQL NUMERIC intentionally returns a decimal string.

Earlier failing or skipped runs are not silently counted as final passes.

## Remaining Boundaries

Native mobile applications, hardware device attestation, full SCIM, app machine
principals, user delegation and the optional three-run performance experiment are
not implemented. Enterprise integration uses synthetic OIDC realms rather than a
real company domain/IdP. Local HTTP and public synthetic credentials are not production settings.
