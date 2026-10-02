# ADR-001: Identity Provider and Reproducible Local Authentication

## Status and Date
Accepted, revised 2026-10-02.

## Decision
Use Keycloak **26.8.0**, pinned as `quay.io/keycloak/keycloak:26.8.0`. The official downloads page and the registry manifest were checked on 2026-10-02; this is the current stable release, not the obsolete 24.0.5 release. Community Keycloak does not promise an enterprise LTS support contract. Review security advisories and deliberately upgrade the exact pin rather than silently following `latest`.

Keycloak owns credentials, OIDC, signing keys, login, federation, refresh rotation and provider sessions. The backend owns issuer+subject identity mapping, platform authorization, tenant memberships, permissions, consent and audit. Authentik is a viable alternative, but switching provides no required feature advantage for this project. A custom identity provider is rejected because it creates unnecessary protocol/security work.

## Local Topology
PostgreSQL is pinned to `postgres:16.15-alpine`, the current supported 16.x minor listed by the official version policy and verified in the container registry. Keeping major 16 preserves compatibility with existing 16.x data volumes; this is a minor binary update, not a destructive major-version migration. Backups remain necessary before updates.

`docker compose up --build -d --wait` starts PostgreSQL, a separate private Keycloak PostgreSQL database, Keycloak, the backend and lightweight static clients. Node is pinned to verified current Node 24 LTS `node:24.21.0-alpine`, compatible with the backend's Node >=24 requirement. The backend installs from its main lockfile with `npm ci`, builds TypeScript, then runs non-destructive migrations and idempotent synthetic seeding. The development image also includes tests and Vitest configuration to run against the private database inside Docker. Neither database exports a host port. Backend HTTP is `http://localhost:3100`, not an unrelated service's port 3000. Client HTTP is `http://localhost:5173`. All exported ports bind loopback only. This is deliberately an HTTP synthetic development lab, not a production TLS deployment.

The fixed issuer is `http://localhost:8180/realms/iam-platform`. Keycloak hostname v2 uses that full external base URL. Inside Docker, backend `JWKS_URL` and `KEYCLOAK_INTERNAL_URL` use `http://keycloak:8080`; changing transport must never change issuer validation. Browser-facing discovery, authorization and redirects remain external. Management readiness is checked with bash `/dev/tcp` and an HTTP 200 status from port 9000 because the Keycloak image has no curl/wget. The management port is not exported.

## Clients and Claims
| Client | Flow | Exact redirect / Purpose |
| --- | --- | --- |
| `iam-web` | Public authorization code + mandatory S256 PKCE | `http://localhost:5173/web.html` |
| `iam-mobile` | Separate public authorization code + mandatory S256 PKCE | `http://localhost:5173/mobile.html` |
| `iam-backend` | Confidential introspection only; no login, password or service-account grant | API audience `iam-backend` |
| `iam-provider-admin` | Confidential client credentials | User/session operations only |
| `iam-test` | Disabled by default; explicitly gated local password grant tests | Never used for demo login |
| `iam-enterprise-broker` | Confidential authorization code + S256 PKCE, enterprise realm | `http://localhost:8180/realms/iam-platform/broker/enterprise/endpoint` |

The browser clients validate state, nonce, signed ID-token issuer/audience/expiry and PKCE. Only the short-lived PKCE transaction goes into sessionStorage; access, ID and refresh tokens remain in memory and never appear in UI, logs or exported files. Reload discards tokens. API calls send an access token in the Authorization Bearer header. Access tokens have `aud` containing `iam-backend` and `typ: Bearer`. A production SPA should use a maintained OIDC client library; a native application must use the OS browser plus verified app/universal links, not this responsive browser demo.

The confidential introspection credential is synthetic `iam-backend / dev-client-secret-change-me`. The separate service credential is synthetic `iam-provider-admin / dev-provider-admin-secret`. Its realm-management scope/role mappings contain only `manage-users`, `view-users`, and `query-users`: no `realm-admin`, `manage-realm`, `manage-clients` or impersonation. These built-in permissions are bounded to user administration in this synthetic realm, not to a single user; the backend must enforce own-session ownership and trusted provisioning before invoking them. Production should use stronger fine-grained admin policies, rotate secrets and protect admin networking. `.env.example` values are never production secrets. Changing an environment variable alone does not rotate an imported client secret.

## Identity and Enterprise Path
Alice through Eve retain platform subjects `70000000-0000-0000-0000-000000000001` through `005`, respectively. Their identity key is the exact platform issuer plus subject, not email. Alice alone has the `platform-admin` realm role. That platform role does not grant tenant membership or bypass tenant authorization.

The imported `iam-enterprise` realm is a standards-faithful synthetic OIDC provider. Its `enterprise.bob / enterprise-bob123` user has subject `71000000-0000-0000-0000-000000000002`. The platform broker validates that realm's issuer and JWKS signature, exchanges codes over the Docker network and has an explicit preconfigured federated link to platform Bob (`...002`). There is no auto-link-by-email or upstream-token storage. Upstream credentials are entered at the enterprise realm. The backend receives a **platform-issued** API token after federation, never a raw enterprise token. This tests OIDC brokering; it does not claim to deploy Active Directory, LDAP or a real organization's SSO.

## Existing Volumes and Upgrade
Startup `--import-realm` **skips existing realms**. Editing import JSON and restarting is insufficient. Back up both databases before the 24-to-26 Keycloak schema upgrade and follow the official upgrading guide. Do not delete volumes or run `docker compose down -v` to apply configuration. The same compose project preserves `pgdata` and `keycloak-pgdata` when recreating its own services.

After upgrading the provider, run `node scripts/configure-keycloak.mjs`. This authenticates the synthetic bootstrap admin and updates only defined realm settings, owned clients/mappers/scopes, explicit broker links and fixture platform roles via the Admin API. Existing users, database rows, signing keys and sessions are not deleted; existing fixture passwords are not reset. Missing realms are imported normally. Missing fixed-subject users use partial import with `SKIP` and are checked afterward. Conflicting existing fixture UUIDs or enterprise links fail instead of reassignment. The script is local-host restricted and never writes or prints tokens. It normally disables `iam-test`; explicit enabling requires both `IAM_ALLOW_PASSWORD_GRANT_TESTS=true` and `--enable-test-client`. Run it again without the flag after tests to disable password grant.

## Verification
For an existing local stack, run these commands from the project root after backing up the databases:

```powershell
docker compose up -d --wait postgres keycloak-db keycloak clients
node scripts/configure-keycloak.mjs
docker compose up -d --build --wait backend
$env:KEYCLOAK_ADMIN_CLIENT_SECRET = 'dev-provider-admin-secret'
node scripts/verify-pkce.mjs
```

The imports are named `iam-platform-realm.json` and `iam-enterprise-realm.json` because Keycloak directory import requires the realm-name filename convention. Keycloak 26 subject issuance is configured explicitly through the `basic` default client scope with `oidc-sub-mapper` for access/ID/introspection claims; the validator still requires `sub`. Normal browser proofs do not require enabling password grant. If Chromium is missing, run `npx --prefix backend playwright install chromium` before the browser proof. If that download is unavailable and Microsoft Edge or Chrome is already installed, explicitly select its supported Playwright channel with `$env:IAM_BROWSER_CHANNEL='msedge'` or `'chrome'`. The script converts resolved module paths to file URLs for Windows-compatible dynamic imports.

For the explicitly gated backend lifecycle suite, enable its test client, run it inside the backend container against the private database/provider network, and disable the test client afterward:

```powershell
$env:IAM_ALLOW_PASSWORD_GRANT_TESTS = 'true'
node scripts/configure-keycloak.mjs --enable-test-client
docker compose exec -T backend env RUN_KEYCLOAK_TESTS=1 npx vitest run tests/security/session-lifecycle.test.ts
node scripts/configure-keycloak.mjs
Remove-Item Env:IAM_ALLOW_PASSWORD_GRANT_TESTS
```

Install Playwright in the backend's development dependencies and its Chromium browser before running `node scripts/verify-pkce.mjs`. The script performs real Keycloak web/mobile logins and enterprise brokering, validates signed audience/type/subject/roles, rejects a wrong PKCE verifier, proves refresh rotation and old-token reuse rejection, revokes only sessions it created, checks immediate API/refresh rejection and confirms another device remains active. It creates no token files, traces or HAR exports. The separate backend lifecycle suite covers provider idle/max expiration, all-session reset, password-change reset and fail-closed outages. Tests must report actual observed behavior, not infer reuse/logout guarantees solely from the realm JSON.

Both realms set `revokeRefreshToken=true` and `refreshTokenMaxReuse=0`. The opt-in password test client has 60-second access tokens and 3-second client idle/max lifetimes so expiry tests are bounded without mutating normal realm timeouts. A JWT signature remains mathematically valid after logout; protected API calls must also perform fail-closed, uncached provider introspection to enforce immediate session revocation.

## References
- Current downloads: https://www.keycloak.org/downloads
- Exact release: https://github.com/keycloak/keycloak/releases/tag/26.8.0
- Registry: https://quay.io/repository/keycloak/keycloak
- Server administration: https://www.keycloak.org/docs/26.8.0/server_admin/
- Container health: https://www.keycloak.org/server/health
- Hostname v2: https://www.keycloak.org/server/hostname
- Import behavior: https://www.keycloak.org/server/importExport
- Upgrade guidance: https://www.keycloak.org/docs/26.8.0/upgrading/
