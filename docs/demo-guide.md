# Mentor Demo: Steps, Expected Results and Explanations

This is a presentation script for the two students. Follow the main demo in order;
use the deeper test sections when the mentor asks for evidence. All accounts are
synthetic development fixtures. Never display/export an access token, refresh token,
browser cookie or private environment file during the meeting.

## 1. What To Prepare Before The Meeting

Requirements: Docker Desktop running with Linux containers; modern browser; host
Node24+ only for configuration/browser verification scripts. Docker runs the backend
and databases. Ports3100,5173,8180 must be free; do not stop unrelated projects.

From the repository root:

```powershell
docker compose up -d --build --wait
docker compose ps
```

**Expected:** five services running and healthy: `backend`, `clients`, `keycloak`,
`postgres`, `keycloak-db`. The first run imports the synthetic realms, applies database
migrations, and seeds the demonstration. Subsequent runs preserve state.

For an older existing provider database, startup import skips existing realms. Apply
the selected configuration without deleting users or volumes:

```powershell
node scripts/configure-keycloak.mjs
```

Do not run `docker compose down -v`. It deletes database volumes and is not a
configuration update. Do not start an infrastructure upgrade just before your meeting.

Open these tabs before presenting:

| Tab | Address/file | Purpose |
|---|---|---|
| Web client | http://localhost:5173/web.html | Main interactive login/tenant demo |
| Mobile-style client | http://localhost:5173/mobile.html | Responsive second public client |
| API health | http://localhost:3100/health | Server liveness |
| Keycloak | http://localhost:8180 | Explain external identity provider |
| Repository report | `docs/repository-report.md` | Architecture and code explanations |
| Test evidence | `docs/verification-evidence.md` | Dated actual execution results |
| Traceability | `docs/traceability-matrix.md` | Mentor requirements mapped to tests |

Run the default fixture/security suite once before the meeting:

```powershell
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 npm test
```

**Expected on the verified source (`fde2efd`):** 211 passed, 16 skipped, 0 failed. The skipped cases
are intentionally gated live-provider lifecycle cases, not failures and not passes.
The complete gated run is explained in section10.

## 2. Opening Explanation (One Minute)

Say:

> We converted the design into a runnable modular monolith. Keycloak handles login,
> federation, signing keys, token issuance and refresh/session lifecycle. Our backend
> handles global-user mapping, tenant memberships, resource ownership, Casbin permissions,
> provisioning, purpose consent and audit. We use two synthetic organizations and have
> verified allowed and denied requests. The complete test run passed159 tests, including
> real provider lifecycle cases. This is an academic prototype, not a production certification.

Show the architecture diagram in the repository report. Explain that separate provider
and database containers do not make the application a distributed-microservice design:
the application modules run together in one Fastify backend.

## 3. Demo: Real Web Login (Two Minutes)

1. Open the web client.
2. Click **Sign in with Keycloak**.
3. At the Keycloak page, enter `alice` / `alice123`.
4. Return to the web client. Wait for **Signed in** and the API profile.

**Expected:**Alice's internal user ID and two active organization memberships.
Passwords are entered at Keycloak, not at our API. The client does not show tokens.

Say:

> This is authorization-code flow with S256 PKCE. The browser sends a challenge and
> later presents its verifier when exchanging the code. A stolen code is insufficient
> without that verifier. State binds the callback to the browser's login attempt, and
> nonce binds the initial ID token. The API receives the access token, not the ID token.

Terms to understand:

| Term | Meaning |
|---|---|
| Authentication | Proving which identity authenticated |
| Authorization | Deciding what that identity may do in a specific organization |
| ID token | Signed login information intended for the client |
| Access token | Credential intended for the protected API |
| Issuer | Provider realm that issued the token |
| Subject | Stable provider user identifier within that issuer |
| Audience | Recipient API/client for which the token is intended |
| JWKS | Provider public signing keys used for signature verification |
| Introspection | Online provider check that the token/session is still active |

## 4. Demo: Same User, Different Tenant Roles (Three Minutes)

Keep Alice signed in. Use **Active organization**, not a second account.

| Action | Expected result | What it proves |
|---|---|---|
| Select Acme; click **List resources** | HTTP200; Acme published resources only | Queries are tenant-filtered |
| Under Acme, click **List members** | HTTP200 | Alice is Acme admin |
| Select Globex; click **List resources** | HTTP200; Globex published resources only | Tenant context changes the returned dataset |
| Under Globex, click **List members** | HTTP403 | Alice's Acme admin role does not carry into Globex |

Say:

> Alice is one global user with two memberships. Her selected organization arrives
> in X-Organization-ID, which is untrusted. The backend rereads active membership
> and tenant-scoped roles. Every resource query includes organization ownership.
> Changing a selector never creates membership or transfers an administrator role.

Do not edit application roles before the demo unless you intend to demonstrate that
change. Tests assume the synthetic fixture roles and restore temporary test changes.

## 5. Demo: Audit Evidence (One Minute)

Return Alice to Acme and click **Tenant audit**.

**Expected:**HTTP200 and queryable events with action, decision, actor, organization,
timestamp and correlation ID. Some globally scoped identity/session events do not
belong to a tenant query; the tenant audit list is not the entire global audit table.

Say:

> The audit stores decisions and request context, not credentials. Local sensitive
> changes, such as grades, commit in the same transaction as their audit record.
> If audit insertion fails, the mutation rolls back. A remote Keycloak revocation
> cannot share a database transaction, so we distinguish request and completion events.

Optional database view, without exposing credentials/tokens:

```powershell
docker compose exec -T postgres psql -U iam_user -d iam_platform -c "SELECT timestamp, action, decision, reason, correlation_id FROM audit_events ORDER BY timestamp DESC LIMIT 15;"
```

## 6. Demo: Instructor and Inactive-Member Boundaries (Two Minutes)

Sign Alice out using **Sign out** before logging in as another user, or use a separate
browser profile. Merely opening another tab may reuse the same Keycloak SSO session.

1. Open the mobile-style client in a narrow viewport.
2. Sign in locally as `bob` / `bob123`.
3. Select Acme and click **My submissions**.
4. Click **List members** to demonstrate an instructor's admin denial.

**Expected:**Bob sees submissions from the course he teaches; member administration
returns403. The grading endpoint exists, but there is no elaborate grading UI. Section9
shows the actual assigned/unrelated grading tests.

Say:

> Role alone is insufficient for grading. The backend verifies that this instructor
> teaches the submission's course in the selected tenant. This is a relational lookup,
> not a custom general relationship-graph platform.

Optional inactive-member demonstration:sign Bob out, sign in as `eve` / `eve123`.
**Expected:**authentication may succeed, but no active Acme membership is available
for tenant access. The automated inactive-member test explicitly verifies denial.
Successful authentication does not imply an active tenant membership.

The mobile page is a responsive browser demonstration, not a native mobile app or
hardware-attested device implementation.

## 7. Demo: Enterprise OIDC Federation (Two Minutes)

1. Sign out of the previous account or use another browser profile.
2. Click **Enterprise OIDC sign in**.
3. On the upstream enterprise login page, enter `enterprise.bob` / `enterprise-bob123`.
4. Return to the platform client and show the resulting API identity/membership.

Say:

> The platform brokers authentication to a separate synthetic enterprise realm.
> Both clients still receive a platform-issued access token for our API. The synthetic
> upstream identity link is explicitly configured; email equality never silently merges
> application accounts. This demonstrates federation, not real-company domain verification.

Platform logout may not terminate an upstream enterprise SSO session. Explain that
provider and upstream session ownership are distinct if a subsequent login is automatic.

## 8. Demo: Refresh and Session Ownership

While signed in, click **Rotate refresh token** and then **My sessions**.

**Expected:**refresh completes and the client reports that the refresh token rotated;
session listing contains the caller's provider sessions. Tokens remain in memory.

Say:

> Keycloak issues and rotates refresh tokens. Our backend never creates a custom
> refresh-token family. It validates access tokens and introspects provider state on
> each authenticated request. A session reference is not proof of a physical device.

Do not manually copy refresh tokens to prove replay. The live tests and browser
verification script safely exercise that behavior in memory.

## 9. Targeted Tests: What To Run and What To Explain

All commands run from the repository root and use real private PostgreSQL. No host
database port needs to be exposed.

### HTTP Resource, Grading and Privacy Tests

```powershell
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false npx vitest run tests/integration/api.test.ts
```

**Expected:**20 tests pass. Explain these representative cases:

- A foreign resource ID under another tenant returns404 without resource data.
- A nonmember tenant selector returns403.
- A learner cannot administer members or read unpublished resources.
- Malformed resource UUID and invalid grade inputs return400.
- An instructor sees assigned submissions and cannot grade unrelated work.
- A permitted grade update and its audit commit together.
- A forced audit insertion failure rolls back the grade mutation.
- Profile-sharing consent allows bio; withdrawal removes it, even during suspension.

These are in-process HTTP tests with production routes/hooks and real DB; real browser
login and online provider enforcement have separate evidence.

### Authorization Policy Tests

```powershell
docker compose exec -T backend npx vitest run tests/security/t05-t08-authorization.test.ts
```

**Expected:**59 tests pass:48 role/resource/action cases plus11 boundary/change cases.

Say:

> Hard tenant and ownership checks run before policy evaluation. Casbin evaluates
> the current role set, with explicit deny overriding allow even across two roles.
> Policy and role changes are reread for subsequent decisions. An already-authorized
> request in flight is a separate concurrency case; we do not claim cancellation.

### Provisioning, Quotas and Consent Tests

```powershell
docker compose exec -T backend npx vitest run tests/security/provisioning-privacy.test.ts
```

**Expected:**9 grouped tests pass, including concurrent operations and multiple assertions.

Explain:

- Same actor/idempotency key/payload creates one organization and bootstrap administrator.
- Reusing the key for another payload is a conflict, not an unauthorized update.
- Organization, roles, membership, idempotency result and audit are one transaction.
- Quota checks lock the organization and are also enforced at the database boundary.
- Suspension denies tenant access; reactivation restores eligible access.
- Consent is append-only and purpose-specific; analytics does not authorize bio sharing.
- Composite foreign keys reject cross-tenant links and inconsistent parent moves.

### Token and Identity Tests

```powershell
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 npx vitest run tests/security/t03-t04-t09-token-validation.test.ts tests/security/t01-t02-identity-membership.test.ts
```

**Expected:**41 token/identity-service cases plus8 membership/identity cases pass.
The production validator checks actual JOSE signatures. Cases include wrong key,
issuer, audience, expired token, ID-token substitution and malformed claims. Real DB
cases verify concurrent first-login mapping and no email-based merging.

### AG01 Reporting Agent (Service Principal)

```powershell
docker compose exec -T backend env RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npx vitest run tests/security/service-principal.test.ts
```

**Expected:** 30 passed (23 fixture/introspection, 7 live). The stack must be up and
`scripts/configure-keycloak.mjs` must have run at least once on old volumes, so the
`iam-agent-reporting` client exists. For a live demo without the test runner:

```powershell
$t = (Invoke-RestMethod -Method Post http://localhost:8180/realms/iam-platform/protocol/openid-connect/token -Body @{grant_type='client_credentials'; client_id='iam-agent-reporting'; client_secret='dev-agent-reporting-secret'}).access_token
Invoke-RestMethod http://localhost:3100/api/v1/resources -Headers @{Authorization="Bearer $t"; 'X-Organization-ID'='10000000-0000-0000-0000-000000000001'}   # Acme: 200
Invoke-WebRequest http://localhost:3100/api/v1/members -Headers @{Authorization="Bearer $t"; 'X-Organization-ID'='10000000-0000-0000-0000-000000000001'} -SkipHttpErrorCheck | Select-Object StatusCode   # 403
```

`-SkipHttpErrorCheck` needs PowerShell 7. In Windows PowerShell 5.1, wrap the second call in `try { } catch { $_.Exception.Response.StatusCode }`.

**Explain:** the agent is not a user. It has no membership or role, and a service token never creates a user row. It is
allowlisted by the `service_principals` registry and can do exactly what `service_principal_grants`
lists: list learning resources in Acme. Identity, session, consent and platform routes refuse it
(403 `PRINCIPAL_KIND_NOT_ALLOWED`). Disabling the Keycloak client denies its already-issued token
on the next request, because introspection is uncached. Its audit rows say `actor_type='service'`.
See `docs/adr/ADR-003-service-principals.md`.

## 10. Complete Test Run Including Live Sessions

The password-grant client is deliberately disabled by default. Enable it only for
the disposable-user lifecycle tests, not for the demonstrated application login.
Host Node24+ is needed to execute the updater. Use `try/finally` so cleanup runs if
the test command fails:

```powershell
$env:IAM_ALLOW_PASSWORD_GRANT_TESTS="true"
try {
    node scripts/configure-keycloak.mjs --enable-test-client
    if ($LASTEXITCODE -ne 0) { throw "Test-client configuration failed" }
    docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test
    if ($LASTEXITCODE -ne 0) { throw "Security tests failed" }
} finally {
    node scripts/configure-keycloak.mjs
    Remove-Item Env:IAM_ALLOW_PASSWORD_GRANT_TESTS -ErrorAction SilentlyContinue
}
```

**Verified result (`fde2efd`, clean clone, 2026-11-07):** 227 passed, 0 failed, 0 skipped, 10 files. (31 Oct, `42d8a43`: 197; 2 Oct, `0d232ec`: 159.) Check the actual current
output before making that claim in a new environment. If configuration fails, do
not claim the live tests ran. If disabling fails, rerun the updater before leaving.

The fixture process disables introspection for its locally signed tokens. Live cases
explicitly re-enable it and call the running API with Keycloak-issued tokens. The
server process remains configured for introspection throughout.

### Session Results You Must Describe Correctly

| Event | Actual observed outcome / explanation |
|---|---|
| Expired access token | Rejected by token validation |
| Short test refresh session expires | Refresh rejected; issued access inactive through introspection |
| Old refresh token replay | Reused and successor refresh400; successor issued access401 before explicit logout |
| Logout | Next request using existing access token401 |
| Own-session revocation | That session denied; another session remains active |
| Logout-all | Existing user-session tokens denied |
| Password reset alone | Old password rejected,new password accepted,but existing access session still200 |
| Password reset plus incident response | Also perform logout-all when existing sessions must be revoked |
| Provider outage | Protected access fails closed; do not confuse liveness with provider availability |

Final recorded operation-to-first-denial durations were62/65/38ms, maximum65ms over
three local samples, below the test's5-second bound. This is not an SLA, large workload
measurement, or proof that already-authorized in-flight requests are cancelled.

## 11. Real Browser Automation Evidence

For a new host, install dependencies and the browser before the meeting:

```powershell
npm --prefix backend ci
npx --prefix backend playwright install chromium
node scripts/verify-pkce.mjs
```

On the verified Windows machine, installed Edge works even when Chromium's CDN
download is unavailable:

```powershell
$env:IAM_BROWSER_CHANNEL="msedge"
try {
    node scripts/verify-pkce.mjs
    if ($LASTEXITCODE -ne 0) { throw "Browser proof failed" }
} finally {
    Remove-Item Env:IAM_BROWSER_CHANNEL -ErrorAction SilentlyContinue
}
```

**Expected:**PASS lines for bounded provider permissions, incorrect PKCE verifier,
web/mobile local login, both enterprise paths, tenant role switch/list filtering,
member403, cross-resource404, audit, foreign-session denial, refresh replay and own
session revocation. Final line: `PKCE browser verification complete`.

The script uses separate browser contexts, keeps tokens in memory, deletes only
its created provider sessions/disposable test user, and writes no traces/HARs.
Browser automation is separate from the159 Vitest count; do not double-count it.

## 11a. Alternate Host (Phone or Another Machine)

Browser-facing URLs are runtime configuration, not source. One variable drives them all:
Keycloak `KC_HOSTNAME`, backend `JWT_ISSUER`/`CORS_ORIGIN`, the client `/config.js`
(issuer/API) and the client CSP. Fixture users are linked to the configured issuer by the seed.

```powershell
node scripts/verify-client-config.mjs              # no Docker: config.js + CSP follow env
$env:IAM_PUBLIC_HOST = "127.0.0.1"                 # different origin, still loopback-only
docker compose up -d --wait
node scripts/configure-keycloak.mjs                # adds the alternate redirect URIs/broker URLs
$env:IAM_BROWSER_CHANNEL = "msedge"; node scripts/verify-pkce.mjs
Remove-Item Env:IAM_PUBLIC_HOST; docker compose up -d --wait; node scripts/configure-keycloak.mjs
```

For a physical phone on the same Wi-Fi use the computer's LAN IP and also set
`IAM_BIND_ADDRESS=0.0.0.0`. That exposes synthetic development credentials to the local
network: do it only on a trusted network and revert afterwards. Changing the host changes the
token issuer; identities are keyed by `(issuer, subject)`, so the seed adds an explicit
fixture link for the new issuer rather than merging by email. A physical phone run was recorded
on 2026-11-07 with option A below (`docs/evidence/2026-11-07/phone-run.md`).

### Physical phone run (step by step)

**Known blocker.** The client computes the PKCE challenge with `crypto.subtle`, which browsers
only expose in a *secure context* (HTTPS, `localhost` or `127.0.0.1`). A plain
`http://<LAN IP>:5173` page is not one, so **Sign in** fails on a phone unless you do one of the
following. Record which one you used.

- **A (LAN, Android Chrome):** mark the three lab origins as secure with a Chrome flag (below).
- **B (USB, Android):** forward the ports over USB so the phone uses `http://localhost`, with no
  stack changes. This is a real phone and browser, but not a LAN run.
- iPhone Safari has no such flag. It would need HTTPS, which the lab does not have.

**Network.** Use your own phone hotspot (laptop connected to it), not campus Wi-Fi: campus
networks often block device-to-device traffic, and this exposes synthetic credentials.

**A. Laptop (PowerShell as Administrator, repository root)**

```powershell
git rev-parse HEAD                                   # note the commit for the record
Get-NetIPConfiguration | ? IPv4DefaultGateway | % { $_.InterfaceAlias + ' ' + $_.IPv4Address.IPAddress }
$env:IAM_PUBLIC_HOST = "<laptop IP on the hotspot>"  # e.g. 192.168.43.25
$env:IAM_BIND_ADDRESS = "0.0.0.0"
docker compose up -d --wait                          # recreates Keycloak/backend/clients for that host
node scripts/configure-keycloak.mjs                  # adds the <IP> redirect URIs and broker URLs
New-NetFirewallRule -DisplayName "IAM lab (temporary)" -Direction Inbound -Protocol TCP -LocalPort 5173,8180,3100 -Action Allow -Profile Any
```

Check from the laptop: `http://<IP>:5173/mobile.html` opens.

**A. Phone (Android Chrome)**

1. Open `chrome://flags`, search **Insecure origins treated as secure**, enter
   `http://<IP>:5173,http://<IP>:8180,http://<IP>:3100`, set **Enabled**, tap **Relaunch**.
2. Note the phone model, the Android version and the Chrome version (`chrome://version`).
3. Start the screen recording (see *Recording*), then open `http://<IP>:5173/mobile.html`.

**Script to perform while recording** (expected result in brackets)

| # | Action | Expected |
|---|---|---|
| 1 | **Sign in with Keycloak**, log in as `alice` / `alice123` | Keycloak page is served from `<IP>:8180`; back on the app it shows signed in, `/me` shows two memberships |
| 2 | Select **Acme**, tap **GET /resources** | 200, Acme published courses only |
| 3 | Acme, **GET /members** | 200 (Alice is an Acme admin) |
| 4 | Select **Globex**, **GET /resources** | 200, Globex courses only |
| 5 | Globex, **GET /members** | **403**: the Acme admin role does not carry over |
| 6 | **GET /sessions** | 200, shows this phone's session |
| 7 | **Rotate refresh token** | succeeds |
| 8 | **Sign out**, then tap any endpoint | signed out; no data |
| 9 | **Enterprise SSO**, log in at the enterprise realm as `enterprise.bob` / `enterprise-bob123` | signed in as Bob through the broker |
| 10 | Acme **GET /resources**, then **GET /members** | 200, then **403** (Bob is an instructor) |
| 11 | **Sign out** | signed out |

**Recording.** Android: pull down Quick Settings, tap **Screen record** (add the tile with the
pencil icon if missing), choose *no audio* and *show touches*, start, perform the script, stop.
The video is saved under Photos/Gallery > Movies or Screen recordings. Before you start, also take a
laptop screenshot of the PowerShell window showing the IP, `git rev-parse HEAD` and
`docker compose ps`. Do not record or share tokens (the app does not display them).

**Undo (always)**

```powershell
Remove-NetFirewallRule -DisplayName "IAM lab (temporary)"
Remove-Item Env:IAM_PUBLIC_HOST, Env:IAM_BIND_ADDRESS
docker compose up -d --wait; node scripts/configure-keycloak.mjs
```

On the phone, set the Chrome flag back to **Default**.

**B. USB alternative (Android, no stack changes):** enable *Developer options > USB debugging*,
connect by USB, open `chrome://inspect/#devices` in desktop Chrome or Edge, click **Port
forwarding**, and add `5173 -> localhost:5173`, `8180 -> localhost:8180` and
`3100 -> localhost:3100`. Tick *Enable port forwarding*. Then on the phone open
`http://localhost:5173/mobile.html` and run the same script. Report it as a USB-forwarded run.

**What to send back for the evidence log:** the video, the laptop screenshot, the commit, the date and
time, the phone/Android/Chrome versions, option A or B, and the status seen at each step.

## 12. Explain One Protected Request

Use Bob requesting a submission as your example:

1. Client sends an access token, not an ID token.
2. Backend validates signature, issuer, audience, required claims and expiration.
3. Backend introspects current provider token/session activity.
4. Verified issuer/subject maps to the application user; email does not merge accounts.
5. Untrusted organization selection is validated against current membership/status.
6. Submission is loaded with both its ID and the selected organization.
7. Teaching or ownership relationship is checked.
8. Casbin evaluates the required permission, with explicit deny precedence.
9. Required audit is persisted before protected data is returned, or with the mutation.
10. Return allow/deny without exposing another tenant's resource.

Authentication establishes identity. Application authorization establishes permission
in the current tenant. Installing Keycloak alone does not satisfy the latter.

## 13. Architecture Choices and Likely Mentor Questions

| Question | Explain in normal English |
|---|---|
| Why a modular monolith? | Two students can deploy/debug one backend and use straightforward transactions while preserving logical module boundaries. |
| Why Keycloak? | Established OIDC/federation/token/session infrastructure avoids building an identity provider. Exact26.8.0 behavior is tested. |
| Why Casbin? | One established declarative engine fits application role/resource rules; PostgreSQL holds tenant/relationship facts. No new graph engine or policy language. |
| Why PostgreSQL? | Relations, uniqueness, composite foreign keys, transactions and locking enforce security-relevant consistency. |
| Why not trust roles only in JWT? | Application tenant roles are reread so next decisions reflect database role/policy changes rather than stale token claims. |
| Why reject signed ID tokens? | They identify a login to a client, not authorize this API; intended audience/type matters. |
| Why not merge by email? | Email can change or be unverified; issuer/subject identifies the external account. |
| What happens after partial provisioning failure? | The local transaction rolls back; an idempotent retry cannot return an uncommitted result. |
| Can suspended users withdraw consent? | Yes; withdrawal intentionally uses service ownership checks rather than active-only tenant hooks. |
| Does a session ID prove a device? | No; it references provider session state, not hardware attestation. |
| Is revocation universally immediate? | No; we verify subsequent requests through uncached introspection and report observed local timings with concurrency caveats. |

## 14. What To Claim and What Not To Claim

**Built and verified:**modular backend; global users/external identities; two tenants;
PKCE login and synthetic enterprise federation; tenant roles; resource/submission
authorization; policy changes/deny precedence; migrations/constraints; transactional
provisioning/quotas/status; consent/profile filtering; audit/fail-closed behavior;
provider lifecycle integration; AG01 application service principal; 227 tests; browser proof; new-volume startup.

**Deferred:** user delegation (AG02), full SCIM, native mobile
apps, hardware-attested devices and real-company domain/SSO integration. A three-run latency
observation exists (`scripts/measure-latency.mjs`) but is not a benchmark. The provider-admin service account is infrastructure;
the application's agent is `iam-agent-reporting` (AG01). Local HTTP and public synthetic fixtures
are not production settings. A zero-advisory npm audit is not a security certification.

The dated evidence report explains observed results and corrected intermediate
failures. A configured feature, an expected-results table or a skipped test is not
execution evidence.

## 15. Troubleshooting and Fallback

```powershell
docker compose ps
docker compose logs backend --tail 40
docker compose logs keycloak --tail 40
docker compose exec -T backend npm run typecheck
docker compose exec -T backend npm audit
```

- Missing Docker daemon: start Docker Desktop before starting Compose.
- Missing dependencies for host scripts: run `npm --prefix backend ci` beforehand.
- Wrong account appears: Keycloak SSO reused a browser session; sign out/use separate profile.
- Revoked/expired session: sign in again; refresh is not a recovery path for revoked sessions.
- Empty instructor list: check seeded teaching relationships/current tenant, not just role.
- Existing realm settings unchanged: run the configuration updater, not a volume reset.
- `/health` means server liveness; `/ready` checks DB, not every external dependency.
- If networking fails during the meeting: show dated evidence and explain the failure;
  do not pretend a previous result was a live run.

## 16. Presentation Division and Closing

Student1 explains architecture, PKCE, tokens, identity mapping and provider sessions.
Student2 explains tenant boundaries, Casbin, constraints, provisioning, privacy and audit.
Both must understand the complete request flow and one positive/negative test pair.

Useful functions to read: `authenticationHook`, `tenantContextHook`, `authorize`,
`provisionOrganization`, `recordConsent`, and one test selected by the evaluator.

Disclose material AI assistance:

> We used AI assistance to accelerate implementation and documentation. We checked
> the implementation with automated tests and live services, and we are reviewing
> the code so we can explain and modify the submitted work ourselves.

Close with:

> We delegated identity infrastructure, implemented application-specific tenant and
> privacy boundaries, reproduced the baseline and attached actual allow/deny evidence.
> The remaining optional extensions are explicitly deferred rather than presented as complete.

Published repository: https://github.com/krishnateja2314/iam-provider.
Verified source baseline: `0d232ecbd567a3482d0ebbc213d39e908e064ee1`.
Use `git rev-parse HEAD` to record the latest submitted commit (which may also include
documentation-only updates). The project name is
`iam-provider`, but it integrates Keycloak; it does not implement a custom identity provider.
