# Execution Evidence

This file is a dated log. Each section states the exact source revision it applies to.
A result from one revision is not evidence for another.

## 2026-11-07: Current Revision `fde2efd` (W5)

Code revision verified: **`fde2efd76a1e30b08577118cc86540c453bf2129`** (W5: AG01 service principal
and dependency remediation). The commit after it adds documentation, evidence logs and
`scripts/measure-latency.mjs` only; no backend, client or realm file changes. Raw, ANSI-stripped logs are in
[`docs/evidence/2026-11-07/`](evidence/2026-11-07/). No tokens, passwords, cookies or traces are in them.

Environment: Windows 11 host, Docker Desktop 29.4.3 (Linux containers), Node 24.21.0-alpine in the
backend image, host Node 24.20.0, Keycloak 26.8.0, PostgreSQL 16.15-alpine, Vitest 5.0.3,
Microsoft Edge through Playwright (`IAM_BROWSER_CHANNEL=msedge`). The W4 review had not been
returned when this run was made, so it answers the W4 report's own plan (Section 7), not new feedback.

### Clean clone, new volumes, `fde2efd`

`git clone` into an empty directory (no `.env`, no `node_modules`), then
`docker compose -p iam-w5clean up -d --build --wait` with newly created volumes (none existed
beforehand). Realm import, migrations 1-4 and seed ran from scratch. All five services were healthy
at 2026-11-07T05:49:09Z. The project's own stack was stopped, not removed, during the run. The
isolated stack and its volumes were removed afterwards (`docker compose -p iam-w5clean down -v`).

| Check (clean stack) | Command | Result |
|---|---|---|
| Typecheck (source and tests) | `docker compose -p iam-w5clean exec -T backend npm run typecheck` | PASS (exit 0) |
| Build | `... exec -T backend npm run build` | PASS (exit 0) |
| Dependency audit | `... exec -T backend npm audit` | **found 0 vulnerabilities** (W4: 4 open) |
| Client configuration | `node scripts/verify-client-config.mjs` | 9 of 9 PASS |
| Complete suite incl. live provider | `IAM_ALLOW_PASSWORD_GRANT_TESTS=true node scripts/configure-keycloak.mjs --enable-test-client`, then `... exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test`, then `node scripts/configure-keycloak.mjs` | **227 passed, 0 failed, 0 skipped**, 10 files |
| W5 outcome command (from the W4 report) | `... exec -T backend env RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npx vitest run tests/security/service-principal.test.ts` | **30 passed** (23 fixture/HTTP and introspection, 7 live) |
| Mutation independence | `COMPOSE_PROJECT_NAME=iam-w5clean node scripts/verify-test-independence.mjs` | baseline 211 pass / 0 fail / 16 skip (live cases skip by design); **11 of 11 killed**, 0 survived, 0 inconclusive; working tree unchanged |
| Runner control, database stopped | `docker stop iam-w5clean-postgres-1`, then the runner | `INCONCLUSIVE baseline`, **exit 2** |
| Real browser PKCE/broker proof | `IAM_BROWSER_CHANNEL=msedge node scripts/verify-pkce.mjs` | **10 of 10 PASS** |
| Alternate origin | `IAM_PUBLIC_HOST=127.0.0.1` stack + configure, then the browser proof and an AG01 smoke call | **10 of 10 PASS**; agent under issuer `127.0.0.1`: Acme list 200, Globex 403, members 403, `/me` 403 |

Per-file counts of the complete suite: api 31, service-principal 30 (7 live), session-lifecycle 21 (6 live),
provisioning-privacy 9, tenant-sso 10 (3 live), t10-audit 6, token-validation 41, startup-config 12,
authorization 59, identity-membership 8. Logs: `clean-up.log`, `clean-checks.log`, `clean-full.log`,
`clean-ag01.log`, `clean-mutation.log`, `mutation-db-down.log`, `clean-pkce.log`, `pkce-127.0.0.1.log`.

The W4 control was repeated because the runner file changed (new mutations). Stopping PostgreSQL with
`docker compose stop postgres` also stops the backend (a dependent), so the first attempt only proved
"backend not running" (also exit 2). The recorded control stops the database container alone.

### Dependency remediation

| Advisory (W4) | Change | Result |
|---|---|---|
| `fastify` 5.12.5 header-validation bypass (GHSA-389g-gv7q-r4x8) | pinned `fastify` 5.12.8 (latest 5.12 patch; the fix landed in 5.12.7) | fixed |
| `fast-uri` scheme injection (GHSA-333x-w4r6-6crp) | lockfile refresh: 3.1.9 under `ajv`, 4.2.3 under `fastify` | fixed |
| `minimatch` globparts DoS (GHSA-g3hv-75wg-m249) via `casbin` 5.51.1 | `overrides.minimatch = 11.0.5` (casbin asks for `^10.2.1`; no 10.x fix exists, and `npm audit fix --force` would downgrade casbin to 5.24.4) | fixed; all 59 authorization cases and the Casbin deny mutation (M7) still pass |
| `vite` 8.3.2 (dev only, via `vitest`; new since W4, high) | lockfile refresh to 8.3.6 | fixed |

### W5 outcome: AG01 application service principal

Design: [`adr/ADR-003-service-principals.md`](adr/ADR-003-service-principals.md). Every expected
result from the W4 plan was observed with real Keycloak client-credentials tokens against the running API:

| W4 expected result | Observed (clean stack) |
|---|---|
| Acme resource list: 200 | 200; every row is Acme and published |
| Globex: 403 | 403 `TENANT_ACCESS_DENIED` (no grant in Globex) |
| An admin action in Acme: 403 | 403 for members, audit events, SSO config and single-resource read; `/me` 403 `PRINCIPAL_KIND_NOT_ALLOWED` |
| An expired token: 401 | client lifespan set to 2 s for one token, then restored; after 3.5 s the token gets 401 |
| An already-issued token after the client is disabled: 401 | first request after disabling: **401, 29 ms** after the admin call started (23 ms in the complete-suite run); a new token request gets `invalid_client` |
| Audit rows record `actor_type='service'` with the client as actor | allow and deny rows: `actor_type='service'`, `actor_id` = the service principal, `metadata.clientId='iam-agent-reporting'` |

The provider issued token has `aud=iam-backend`, `azp=iam-agent-reporting`, `principal_kind=service`, no
`sid` and no realm roles. The fixture cases add: no user, identity or membership row is ever created;
unregistered and registry-disabled principals get 401; session-bound, client-mismatched and malformed
`principal_kind` tokens get 401; a suspended tenant denies the agent even with a grant; a human token from
the agent client fails the human allowlist; ten ungranted tenant actions (including POST resource, member and
policy) get 403, and the attempted course creation leaves no row.

Mutations added for the new guards, each killed on the clean stack:

| ID | Guard broken on purpose | Result |
|---|---|---|
| M8 | Disabled service principal refused by the registry | Killed (1 test) |
| M9 | Introspection binds the token to the client's own service account | Killed (1) |
| M10 | Human-only routes refuse service principals | Killed (2) |
| M11 | Grant must match the exact action | Killed (1) |

Observation, not a defect in our code: re-enabling a disabled Keycloak client makes its still-unexpired
tokens active again. Setting the registry row to `disabled` is the switch that stays off (tested).

### Latency observation (performance experiment)

`docker compose -p iam-w5clean exec -T backend node --input-type=module - < scripts/measure-latency.mjs`,
inside the backend container (so the Windows Docker port forwarder, a fixed ~15 ms per request even for
`/health`, is excluded). 3 runs x 200 sequential requests per series after 20 warm-up requests; all 1,800
responses were 200. Log: `latency.log`.

| Series (ms) | p50 run 1 / 2 / 3 | p95 run 1 / 2 / 3 |
|---|---|---|
| `GET /health` (no auth) | 0.70 / 0.55 / 0.48 | 1.36 / 1.47 / 1.39 |
| Provider introspection call alone | 2.43 / 2.44 / 2.11 | 4.37 / 4.78 / 3.75 |
| Agent `GET /api/v1/resources` (full path) | 7.23 / 6.88 / 6.17 | 9.88 / 9.97 / 9.66 |

Uncached introspection is about a third of the authenticated request (median p50 2.4 of 6.9 ms). This
is the price of rejecting a revoked or disabled credential on the next request. It is a single-machine,
sequential observation; no throughput, concurrency or production claim is made, and no optimisation
was attempted.

### Not done / not claimed

- No physical-phone run (owner: Jaya Prakash) and no independent rerun on a second machine yet.
- AG02 (user-delegated agent), DNS domain verification, SCIM, a grant-management API and a real corporate IdP.
- The latency numbers are not a benchmark.

---

## 2026-10-31: Revision `42d8a43` (W4)

Code revision verified: **`42d8a43eb07a98f74b94ab6e712353bdaa643a7c`** (all code changes for
the W3 review). The commit after it changes documentation only. Raw, ANSI-stripped logs are in
[`docs/evidence/2026-10-31/`](evidence/2026-10-31/). No tokens, passwords, cookies or traces are in them.

Environment: Windows 11 host, Docker Desktop 29.4.3 (Linux containers), Node 24.21.0-alpine in
the backend image, host Node 24.20.0, Keycloak 26.8.0, PostgreSQL 16.15-alpine, Vitest 5.0.3,
Microsoft Edge through Playwright (`IAM_BROWSER_CHANNEL=msedge`).

### Baseline before any change (`953a0aa`, repository HEAD when this work started)

`docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 npm test`
at 2026-10-31T08:54:02Z, real PostgreSQL: **160 passed, 1 failed, 6 skipped**. The failure is
`consent grants bio only for its purpose and withdrawal remains possible during suspension`,
which got `expected 403 to be 200`. This confirms the mentor's P1 finding on a real database. The 2 Oct
"159 passed" result was from an earlier revision and did not apply to `953a0aa`.
Log: `baseline-953a0aa.log`.

### Clean clone, new volumes, `42d8a43`

`git clone` of the repository into an empty directory (no `.env`, no `node_modules`), then
`docker compose -p iam-w4clean up -d --build --wait` with **newly created volumes**. Realm
import, migrations 1-3 and seed ran from scratch. All five services were healthy at 2026-10-31T09:18:14Z.
The image build ran `npm ci` and `npm run build`. The original project's stack was stopped,
not removed, during this run, and its volumes were not touched. The isolated stack and its own
volumes were removed afterwards.

| Check (clean stack) | Command | Result |
|---|---|---|
| Typecheck (source **and tests**) | `docker compose -p iam-w4clean exec -T backend npm run typecheck` | PASS (exit 0) |
| Build | `... exec -T backend npm run build` | PASS (exit 0) |
| Dependency audit | `... exec -T backend npm audit` | **4 advisories (1 low, 3 moderate)**. See below |
| Host install for browser proof | `npm --prefix backend ci` | PASS (exit 0) |
| Complete suite incl. live provider | `IAM_ALLOW_PASSWORD_GRANT_TESTS=true node scripts/configure-keycloak.mjs --enable-test-client`, then `... exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test`, then `node scripts/configure-keycloak.mjs` | **197 passed, 0 failed, 0 skipped**, 9 files, started 2026-10-31T09:18:36Z |
| Mutation independence | `COMPOSE_PROJECT_NAME=iam-w4clean node scripts/verify-test-independence.mjs` | baseline 188 pass / 0 fail / 9 skip; **7 of 7 mutations killed**, 0 survived, 0 inconclusive; working tree unchanged |
| Real browser PKCE/broker proof | `IAM_BROWSER_CHANNEL=msedge node scripts/verify-pkce.mjs` | **10 of 10 PASS** |

Per-file counts of the complete suite: api 31, session-lifecycle 21 (6 live), provisioning-privacy 9,
tenant-sso 10 (3 live), t10-audit 6, token-validation 41, startup-config 12, authorization 59,
identity-membership 8. Logs: `clean-full.log`, `clean-checks.log`, `clean-mutation.log`, `clean-pkce.log`.

**npm audit, honestly reported.** On 2 Oct the audit reported 0. On 31 Oct the same pinned
dependencies have new advisories: `fast-uri` (transitive, fix available via lockfile),
`fastify` 5.12.5 header-validation bypass GHSA-389g-gv7q-r4x8 (fixed in 5.12.7), and `minimatch`
via `casbin`. They are not fixed in this revision, because upgrading would invalidate the evidence
above. They are the first W5 action.

### Live provider observations (clean stack)

| Operation | First existing-token request | Operation start to denial |
|---|---|---|
| Provider logout | 401 | 62 ms |
| Own-session API revocation | 401 | 52 ms |
| Admin logout-all | 401 | 31 ms and 158 ms (two cases) |

Max 158 ms over 4 samples, under the test's 5 s bound. This is a local observation, not an SLA.
Password reset: `{"oldCredentialsAccepted":false,"newCredentialsAccepted":true,"previouslyIssuedAccessTokenStatus":200}`.
Reset alone still does not revoke sessions, and incident response must call logout-all.
Refresh replay: `{"reusedRefreshStatus":400,"successorRefreshStatus":400,"successorIssuedAccessTokenStatus":401}`.

### What each W3 finding now has as evidence

| W3 finding | Test / evidence | Observed |
|---|---|---|
| Suspended consent withdrawal (W3-FB005) | Existing `api.test.ts` consent case (200 expectation unchanged) and new case covering **organization** and **membership** suspension | Both pass on real PostgreSQL. Withdrawal 200 under each suspension; grant 403; foreign tenant (Globex) and unknown org 403 `TENANT_ACCESS_DENIED`; exactly two rows appended; `consent.withdraw` audit row with actor and org |
| Fatal startup check | `startup-config.test.ts` spawns `src/server.ts` as a subprocess | Production + `KEYCLOAK_INTROSPECTION=false` exits **1**, prints `Startup refused: ...`, and the port refuses connections. A positive control with safe config answers `/health` 200. The same probe against the **production image** (`node dist/server.js`) also exited 1 with the port refused |
| Outage status contract | `api.test.ts` "provider dependency contract" | Network failure, provider 500 and provider 503 give **exactly 503 `DEPENDENCY_UNAVAILABLE`**, with `fetch` called once each. `active:false` gives **exactly 401**. Matching active session gives 200. `sid` is now in `claims`, and tests are typechecked |
| Mutation runner false success | `verify-test-independence.mjs` | 7 of 7 killed with named assertion failures. With PostgreSQL stopped the runner printed `INCONCLUSIVE baseline` and exited **2** (`mutation-db-down.log`, runner code identical to `ece833d`). The old script would have printed SUCCESS |
| Foreign submission fixture | `api.test.ts` substitution test | A real Globex submission is created via the API and read by its owner (200). The same ID via the Acme selector gives 404 for the Acme **admin** and the Acme instructor on both read and grade. Not in the Acme list. Grade still `null`. Positive control: Globex admin grades it (200) |
| Third tenant | `api.test.ts` third-tenant test | Provisioned over HTTP by platform admin (non-admin 403, retry idempotent). New admin creates courses and adds a learner. Learner sees only published, cannot read drafts or manage members. Platform admin without membership 403. Cross-tenant 404 both directions |
| M5 domain/SSO association | `tenant-sso.test.ts` (7 DB and 3 live cases) | Association persisted and audited in the provisioning transaction. Changed SSO payload under the same key gives conflict. A domain owned by another tenant rolls back the whole tenant. Unknown alias and malformed domain rejected before writes. Suspended tenant not discoverable. **Live:** the discovered hint for the new tenant makes Keycloak 303 into `/realms/iam-enterprise/.../auth` with `client_id=iam-enterprise-broker`. Controls: no hint serves the login page, and an unknown alias never reaches the enterprise realm |
| Hard-coded hostnames | `verify-client-config.mjs`, and `verify-pkce.mjs` with `IAM_PUBLIC_HOST=127.0.0.1` | 9 of 9 config checks pass. **Full browser proof 10 of 10 PASS on the alternate origin `127.0.0.1`** (local and enterprise broker, web and mobile) with no source edits (`pkce-127.0.0.1.log`, code identical to `42d8a43`). A physical phone on the LAN was **not** tested |

### Not done / not claimed

- No physical-phone run, native app, DNS domain verification, SCIM or real corporate IdP.
- AG01/AG02 agent identities and the performance experiment are still not implemented.
- npm audit advisories above are open.

---

# Historical: Execution Evidence - 2026-10-02 (revision `0d232ec`)

These results apply to the 2 Oct revision only. As the baseline above shows, they did not carry over to `953a0aa`.

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
