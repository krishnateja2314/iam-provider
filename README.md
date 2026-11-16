# Secure Multi-Tenant Identity and Access Platform

Team **P01-G33** · CS5903 (IIT Hyderabad, 2026) · Krishna Teja (CS23BTECH11028), Jaya Prakash (CS23BTECH11015)
Repository: https://github.com/krishnateja2314/iam-provider · Final tag: **`cs5903-final-2026`**

An identity and access platform for a multi-tenant learning SaaS. **Keycloak proves who a person or
program is. Our backend decides, per tenant and per request, what that principal may do.** One
person can be an admin in one organization and a learner in another, and nothing leaks between them.
AI agents are first-class principals. An application service principal (AG01) acts as itself with
one exact grant. A user-delegated agent (AG02) acts for a user with
*user permission ∩ delegated scope ∩ tenant*, revocable on the next request.

## Submission documents

| Deliverable | Location |
|---|---|
| A. Project Report (guide format, 8 pages) | [`docs/Project_Report.pdf`](docs/Project_Report.pdf) (source `docs/report/Project_Report.tex`) |
| B. Architecture Decision Records | [`docs/Architecture_Decision_Records.md`](docs/Architecture_Decision_Records.md) (14 records, incl. the 9 Oct methodology record) |
| Experimental evaluation (baseline vs solution, raw results, figures) | [`evaluation/README.md`](evaluation/README.md) |
| Recorded demonstration (100 s, captioned, real stack) | [`docs/demo/demo-walkthrough.mp4`](docs/demo/demo-walkthrough.mp4) · regenerate with `node scripts/record-demo.mjs` |
| Final presentation | [`docs/Final_Presentation.pptx`](docs/Final_Presentation.pptx) |
| Full final report (61 pages, 36 issues and fixes) | [`docs/Final_Report_Full.pdf`](docs/Final_Report_Full.pdf) (source `final_report.tex`) |
| Evidence per revision and date (raw logs) | [`docs/verification-evidence.md`](docs/verification-evidence.md), `docs/evidence/` |
| Open work | [`docs/open-issues.md`](docs/open-issues.md) / GitHub issues |

## Current status

Verified code revision **`e13f019`** (clean clone, new volumes, 2026-11-14). The final tag adds only
documentation, evaluation scripts and results. `backend/`, `clients/` and `infrastructure/` are
unchanged.

| Check | Result |
|---|---|
| Full suite, real PostgreSQL + live Keycloak | **253 passed, 0 failed, 0 skipped** |
| Mutation runner (injected security bugs) | **15 / 15 killed**; database stopped → *inconclusive*, exit 2 |
| Real-browser proof (PKCE, broker, sessions, AG02) | **11 / 11** on `localhost` and on `127.0.0.1` |
| `npm audit` | 0 vulnerabilities |
| Baseline (JWT-only) vs ours, after logout / logout-all / agent disable | baseline accepted the revoked token in 15/15 trials (agent: 59.4 s median); **ours: 401 on the first request in 15/15** |

| Status | Items |
|---|---|
| **Completed and verified** | M1 identity and tenant model · M2 sign-in and federation (web, mobile-style client, enterprise broker) · M3 session lifecycle · M4 fine-grained authorization (59 scenarios) · M6 consent and audit · M7 security validation · AG01 · AG02 |
| **Partial** | M5 provisioning is the agreed minimal slice (no full SCIM) · policy rows cannot be deleted · AG01 grants are DB-only · AG02 uses a custom header, not RFC 8693 |
| **Pending / not done** | Native mobile apps · real corporate IdP / SAML · production hardening · independent second-machine rerun · CI |

## Architecture summary

Five Docker Compose services: `clients` (static web and mobile-style pages), `keycloak` 26.8.0 with
its private `keycloak-db`, `backend` (Node 24, Fastify 5, a modular monolith) and `postgres` 16.
Every protected request passes four stages: (1) verify the JWT, then run *uncached* introspection
with Keycloak; (2) tenant context: `X-Organization-ID` is untrusted and must match an active
membership, an AG01 grant or an AG02 delegation; (3) hard boundaries: tenant ownership,
published-only, teaching relationship, submission owner, delegated scope; (4) Casbin with
deny-overrides. Every query filters on the organization. Audit rows commit in the same transaction
as the change. Details: [ADR log](docs/Architecture_Decision_Records.md) ·
[repository report](docs/repository-report.md) · [threat model](docs/threat-model.md) ·
[domain model](docs/domain-model.md).

```
backend/src/modules/  auth · user · organization · authorization · learning-resource · provisioning · audit · service-principal · delegation
backend/src/db/       5 migrations, idempotent synthetic seed
backend/tests/        11 test files (253 tests)
clients/              web.html, mobile.html, app.js, server.mjs
infrastructure/       Keycloak realm imports (platform + synthetic enterprise IdP)
scripts/              configure-keycloak, verify-pkce (browser proof), verify-test-independence (mutations), measure-latency, demo-delegation, record-demo
evaluation/           baseline-vs-solution experiment, clean-state run, raw results, figures
```

## Prerequisites (pinned)

- Docker Desktop with Linux containers. Images are pinned: `node:24.21.0-alpine`,
  `postgres:16.15-alpine`, `quay.io/keycloak/keycloak:26.8.0`.
- Host Node ≥ 24, only for the configuration, browser-proof and demo scripts. Backend
  dependencies are pinned by `backend/package-lock.json`.
- Optional: Python 3 with matplotlib (to regenerate figures); Microsoft Edge or Chrome (browser proof).
- Free local ports 3100, 5173 and 8180 (all bound to 127.0.0.1).
- No external accounts, API keys or paid services.

## Environment variables

Compose defaults work without a `.env`. [`.env.example`](.env.example) lists every variable with
safe synthetic values. Copy it to `.env` only to override them. The most relevant are:

| Variable | Default | Purpose |
|---|---|---|
| `IAM_PUBLIC_HOST` | `localhost` | Browser-facing host for issuer, API, CORS and clients (for example `127.0.0.1` or a LAN IP) |
| `KEYCLOAK_INTROSPECTION` | `true` | May be `false` **only** with `NODE_ENV=test`; any other combination refuses to start |
| `KEYCLOAK_CLIENT_SECRET` / `KEYCLOAK_ADMIN_CLIENT_SECRET` | synthetic | Must match the realm import; changing `.env` does not rotate them |
| `IAM_ALLOW_PASSWORD_GRANT_TESTS` | `false` | Explicit opt-in for live provider tests (see Test) |
| `IAM_BROWSER_CHANNEL` | (bundled Chromium) | `msedge` or `chrome` for browser scripts |

## Install, migrate, seed and run

```powershell
git clone https://github.com/krishnateja2314/iam-provider.git
cd iam-provider
git checkout cs5903-final-2026
docker compose up -d --build --wait
```

The first run imports both realms, runs the five migrations and inserts the synthetic seed.
Migrations and seed are idempotent and run automatically on every backend start. There is no
separate migrate step. Expected: five services reported `Healthy` (about 70 s on the reference laptop).

| Service | Address |
|---|---|
| Web demo | http://localhost:5173/web.html |
| Mobile-style demo | http://localhost:5173/mobile.html |
| API | http://localhost:3100 (`/health`, `/ready`, `/api/v1/*`) |
| Keycloak | http://localhost:8180 (admin `admin` / `admin_dev_password`, lab only) |
| Databases | private Docker network only |

### Synthetic users

| User | Password | Acme Learning Corp | Globex University |
|---|---|---|---|
| alice | `alice123` | admin | learner |
| bob | `bob123` | instructor (assigned TypeScript course) | — |
| charlie | `charlie123` | learner | — |
| diana | `diana123` | — | admin / instructor |
| eve | `eve123` | inactive learner | — |
| enterprise.bob | `enterprise-bob123` | via enterprise SSO, linked to bob | — |

Alice also has the Keycloak `platform-admin` role for provisioning only. It never bypasses tenant
membership.

### Example input and expected output (demo path)

1. Open the web demo and sign in as `alice` (Keycloak login, PKCE).
2. Select **Acme**, press `GET /members` → **200 Allowed**. Select **Globex**, press `GET /members` → **403 Denied**.
3. In Globex press `POST /delegations` → **201**. Copy the `delegation.id` from the raw JSON and run:

```powershell
node scripts/demo-delegation.mjs <delegation-id> 10000000-0000-0000-0000-000000000002
```

Expected output:

```
403  GET /resources   without delegation (agent has no authority of its own)
200  GET /resources   with delegation (N rows)
200  GET /submissions with delegation (only the delegator's own) (N rows)
403  GET /members     with delegation (admin action, never delegable)
403  GET /resources   with delegation in another tenant
```

After revoking the delegation, the delegated calls return **401**. Clicking *Sign out* makes the
old access token return 401 on `/api/v1/me`. The whole path is recorded in
[`docs/demo/demo-walkthrough.mp4`](docs/demo/demo-walkthrough.mp4). Rerecord it with
`$env:IAM_BROWSER_CHANNEL="msedge"; node scripts/record-demo.mjs` (needs `npm --prefix backend ci`
and `npx --prefix backend playwright install ffmpeg`). More walkthroughs:
[demo guide](docs/demo-guide.md), [presentation guide](docs/presentation-guide.md).

## Test (commands and expected outcomes)

```powershell
docker compose exec -T backend npm run typecheck        # exit 0
docker compose exec -T backend npm run build            # exit 0
docker compose exec -T backend npm audit                # found 0 vulnerabilities
node scripts/verify-client-config.mjs                   # 9 PASS, no Docker needed

docker compose exec -T backend npm test                 # 231 passed, 22 skipped (no DB/provider gates)
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 npm test
                                                         # 233 passed, 20 skipped (real PostgreSQL)
```

Skipped tests are never counted as passes. The complete suite with the live provider needs the
gated password-grant test client. Enable it, run the suite, then disable it again:

```powershell
$env:IAM_ALLOW_PASSWORD_GRANT_TESTS = "true"
node scripts/configure-keycloak.mjs --enable-test-client
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 RUN_KEYCLOAK_TESTS=1 npm test
                                                         # 253 passed, 0 failed, 0 skipped
node scripts/configure-keycloak.mjs
Remove-Item Env:IAM_ALLOW_PASSWORD_GRANT_TESTS
```

`KEYCLOAK_INTROSPECTION=false` in these commands affects only the test process, which uses signed
local fixtures. The running API always introspects.

```powershell
node scripts/verify-test-independence.mjs   # mutation check: exit 0 only if 15/15 killed; exit 2 = inconclusive
npm --prefix backend ci; npx --prefix backend playwright install chromium
node scripts/verify-pkce.mjs                 # real-browser proof: 11 PASS lines
```

Frozen acceptance criteria: [`docs/evaluation-protocol.md`](docs/evaluation-protocol.md).
Requirement-to-test mapping: [`docs/traceability-matrix.md`](docs/traceability-matrix.md).
The end-to-end scenario is the browser proof plus the demo path above. Critical robustness cases
(cross-tenant IDs, header substitution, suspended members, provider outage, unsafe configuration,
refresh replay) are in `backend/tests/security/`.

## Reproducible experiments

[`evaluation/README.md`](evaluation/README.md) has the evaluation questions, the baseline (JWT-only
validation), the workloads, the environment, the raw result files and the commands to regenerate
every number and figure. One command runs everything from a fresh clone with new volumes:

```powershell
docker compose stop      # the clean run uses the same ports
powershell -ExecutionPolicy Bypass -File evaluation\run-clean-evaluation.ps1 -Revision cs5903-final-2026
```

## Operational handover

| Task | Command |
|---|---|
| Start / stop (keeps data) | `docker compose up -d --wait` / `docker compose stop` |
| Status and health | `docker compose ps`; `curl http://localhost:3100/ready` |
| Logs | `docker compose logs -f backend` (also `keycloak`, `postgres`, `clients`). Credentials and bodies are redacted |
| Database shell | `docker compose exec postgres psql -U iam_user -d iam_platform` |
| Apply realm changes to an existing stack | `node scripts/configure-keycloak.mjs` (non-destructive; `--import-realm` skips existing realms) |
| **Full reset (deletes all data)** | `docker compose down -v` then `docker compose up -d --build --wait` |

Never run `docker compose down -v` on data you need. Back up both databases before a Keycloak
upgrade.

Troubleshooting:
- **Every API call returns 503 `DEPENDENCY_UNAVAILABLE`.** Keycloak is down or unreachable, and
  the API fails closed by design. Check `docker compose ps keycloak` and its logs.
- **The backend exits with `Startup refused`.** The security configuration is unsafe (for
  example, introspection disabled outside tests). Fix `.env`.
- **401 right after login on a changed host.** `IAM_PUBLIC_HOST` changed but the realm was not
  updated. Run `node scripts/configure-keycloak.mjs`.
- **Phone over plain HTTP fails at login.** PKCE needs a secure context. Enable Chrome's
  "Insecure origins treated as secure" flag for the laptop address
  ([`docs/evidence/2026-11-07/phone-run.md`](docs/evidence/2026-11-07/phone-run.md)).
- **Browser scripts cannot find Chromium.** Run `npx --prefix backend playwright install chromium`
  or set `IAM_BROWSER_CHANNEL=msedge`.
- **Mutation runner exits 2.** The baseline was not green (database down, or the container source
  differs from the checkout). Rebuild with `docker compose up -d --build --wait`.
- **A port is already in use.** Ports 3100, 5173 and 8180 are fixed in `docker-compose.yml`. Stop the other service.

External services: none beyond the Compose stack, and there are no costs or quotas. Everything
runs offline after the images are pulled.

## Security contract (summary)

- Only RS256 access tokens with the required issuer, audience, subject, expiry and `typ=Bearer` are
  accepted. ID tokens are refused. Every request is introspected without a cache. If the provider
  fails, the request gets 503 (never allowed). Invalid or inactive tokens get 401.
- `X-Organization-ID` is untrusted. Active membership and organization status are checked, and
  every resource or submission query includes the organization.
- Explicit denies override allows across all of a user's roles. Roles and policies are re-read for
  every decision; there is no cache.
- Sensitive mutations and their audit event commit together. Provider-side revocations log
  separate request and completion events.
- Consent is purpose-specific and append-only. Withdrawal is allowed while suspended.
- Identities are keyed by issuer + subject and never merged by email.
- Agents never get user accounts. AG01 needs an exact grant. AG02 is evaluated as its user, limited
  to the delegated scopes and tenant, and administrative scopes are never delegable.

## Limitations

This is a local HTTP lab with public synthetic credentials. It is not a production deployment.
The mobile client is a responsive web page, not a native app. Enterprise SSO brokers to a
synthetic second realm (no SAML, no DNS-verified domains). Audit is not tamper-evident. In-flight
requests are not re-checked. Latency figures are sequential single-machine observations. All
evidence comes from one machine. The full list is in the Project Report §8 and in
[`docs/open-issues.md`](docs/open-issues.md).

## Safety and provenance

All users, tenants, courses and secrets are synthetic and intended for public use. No real personal
data, API keys or private credentials are committed. `.env` files, dependencies, build output and
historical personal reports are not tracked. Third-party components (Keycloak, PostgreSQL,
Node.js, Fastify, Casbin, jose, Kysely, Vitest, Playwright) are used under their open-source
licences through official images and the lockfile.
