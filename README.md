# Secure Multi-Tenant Identity and Access Platform

Repository: https://github.com/krishnateja2314/iam-provider

Current verified code revision: `42d8a43` (clean clone, new volumes, 2026-10-31: 197 passed,
0 failed, 0 skipped; mutation check 7/7 killed; browser proof 10/10). Earlier baseline: `0d232ec`.

Academic modular-monolith prototype for two synthetic learning organizations.
Authentication is delegated to Keycloak; tenant membership, resource ownership,
Casbin authorization, provisioning, consent and audit are application responsibilities.

## Read First

- [Whole repository report](docs/repository-report.md): architecture, modules, security decisions and mentor explanations.
- [Demo guide](docs/demo-guide.md): reproducible tests and evaluator walkthrough.
- [Presentation guide](docs/presentation-guide.md): plain-English demo script, UI tour, numbers to quote and likely questions.
- [Requirements matrix](docs/traceability-matrix.md): implemented versus verified requirements.
- [Evaluation Protocol](docs/evaluation-protocol.md): Frozen acceptance criteria and protocol.
- [Mentor Responses](docs/mentor-responses.md): Responses to the 8 mentor review questions.
- [Actual execution evidence](docs/verification-evidence.md): dated per revision, with raw logs in `docs/evidence/`.
- [Threat model](docs/threat-model.md) and [domain model](docs/domain-model.md).
- Architecture decisions are in `docs/adr/`.
- Historical TeX/PDF submissions remain local and are not included in this publication; the current Markdown reports describe the runnable implementation.

## Start From A Clean Checkout

Install Docker Desktop with Linux containers. Host Node is only needed for configuration
and browser proof scripts; backend/database tests run inside Docker.

```powershell
docker compose up -d --build --wait
```

The first run imports two realms, migrates PostgreSQL and inserts synthetic fixtures.
Existing tenant state is preserved on ordinary restarts. If upgrading an existing
checkout, Keycloak skips existing realm imports. Apply the non-destructive updater:

```powershell
node scripts/configure-keycloak.mjs
```

Never run `docker compose down -v` on a database you need to preserve. Back up provider
storage before a Keycloak version upgrade. The local upgrade from 24.0.5 to 26.8.0 was
performed with a database backup; that private backup is not part of the repository.

| Service | Local address |
|---|---|
| API | `http://localhost:3100` |
| Web demonstration | `http://localhost:5173/web.html` |
| Mobile-style demonstration | `http://localhost:5173/mobile.html` |
| Keycloak | `http://localhost:8180` |
| Application/provider databases | Private Docker network only |

All credentials in realm imports and defaults are deliberately public, synthetic,
development-only fixtures. Do not deploy these HTTP/local credentials publicly.

## Test

```powershell
docker compose exec -T backend npm run typecheck   # source and tests
docker compose exec -T backend npm run build
docker compose exec -T backend npm audit
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 npm test
node scripts/verify-test-independence.mjs          # mutation check; needs the running stack
node scripts/verify-client-config.mjs              # runtime host config; no Docker needed
```

`npm test` without live flags is expected to give 188 passed, 9 skipped. The mutation check exits 0 only
if every mutated security guard is caught by its named tests. It exits 2 (inconclusive) if the
database is down, the baseline fails, or the container source differs from the checkout.
`KEYCLOAK_INTROSPECTION=false` is accepted only with `NODE_ENV=test` (the test setup sets it).
Any other environment refuses to start.

The last command uses real PostgreSQL and signed local JOSE fixtures. It does not
disable introspection in the running API process. Live provider lifecycle tests
are separately gated, and skipped results must not be counted as passes:

```powershell
$env:IAM_ALLOW_PASSWORD_GRANT_TESTS = "true"
node scripts/configure-keycloak.mjs --enable-test-client
docker compose exec -T backend env RUN_KEYCLOAK_TESTS=1 npx vitest run tests/security/session-lifecycle.test.ts
node scripts/configure-keycloak.mjs
Remove-Item Env:IAM_ALLOW_PASSWORD_GRANT_TESTS
```

For real authorization-code + PKCE browser proof:

```powershell
npm --prefix backend ci
npx --prefix backend playwright install chromium
node scripts/verify-pkce.mjs
```

## Synthetic Users

| User | Development password | Acme | Globex |
|---|---|---|---|
| alice | `alice123` | admin | learner |
| bob | `bob123` | instructor, assigned TypeScript course | none |
| charlie | `charlie123` | learner | none |
| diana | `diana123` | none | admin/instructor |
| eve | `eve123` | inactive learner | none |

Alice additionally has the explicit Keycloak platform-admin role for provisioning.
That role does not bypass tenant membership or grant cross-organization course access.
Enterprise broker users authenticate in a separate synthetic upstream realm; email
equality never silently merges their application accounts.

## Security Contract

- Only RS256 access tokens with required issuer, audience, subject, expiration and
  `typ=Bearer` are accepted. ID tokens are not API credentials.
- Every configured API authentication also performs uncached provider introspection.
  Provider failures deny access with 503 `DEPENDENCY_UNAVAILABLE`. Invalid or inactive tokens get 401.
  An unsafe security configuration (for example, introspection disabled outside tests) stops the
  process before it listens.
- `X-Organization-ID` is untrusted. Active membership and organization status are
  checked, and resource/submission queries always include organization ownership.
- Explicit denies override matching allows across roles. Policy rows are reread for
  subsequent decisions; there is no cross-tenant authorization cache.
- Sensitive local mutations and their audit event commit together. Remote provider
  revocations record request/completion separately because they cannot share a DB transaction.
- Consent is purpose-specific and append-only. Withdrawal of one's own consent is allowed while
  the membership or organization is suspended. Grants and foreign tenants are denied.
- A tenant may be provisioned with an email domain and a configured Keycloak broker alias.
  `GET /api/v1/sso/discover` returns the alias for Keycloak's `kc_idp_hint`. Domains are not DNS-verified.
- Browser-facing hosts come from `IAM_PUBLIC_HOST` (default `localhost`). See demo guide section 11a.
- The prototype is not a production deployment: local HTTP, development credentials,
  bounded provider-admin integration and synthetic datasets require production hardening.

## Scope

Core human identity and tenant access are the priority. Full SCIM, optional machine
identity/delegation, and the optional controlled performance experiment are not claimed
complete. The traceability matrix records remaining verification and implementation gaps.
The prototype and its demo documentation are published in the repository linked above.
Local `.env` files, dependencies, compiled output, backups and historical personal reports
are not included in the published commit.
