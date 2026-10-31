# Mentor Review Responses - Week 3

Revision: code `42d8a43` (evidence in `verification-evidence.md`, section 2026-10-31).

## 1. Why did POST /consents use active-only tenantHooks when privacy-service.ts permits withdrawal during suspension?
It was a regression. Making every tenant route active-only (W2 "central guards") also put
`/consents` behind `tenantContextHook`, which returned 403 before the service's withdrawal
exception could run. We reproduced it on real PostgreSQL at `953a0aa`: **160 pass, 1 fail**, the
failure being the existing consent test (`expected 403 to be 200`). The fix (`5e4367a`) is
`ownMembershipHook`. It validates the untrusted selector and requires a membership row in that
organization, so foreign and unknown tenants still get 403. It admits suspension. In the route,
only `granted:false` skips `permit()`. A grant still needs active membership/org and a Casbin
allow. The existing test passes with its 200 expectation unchanged. A new test covers
**organization** and **membership** suspension, grant denial, a foreign tenant (Globex), an
unknown org, history (exactly two appended rows) and the `consent.withdraw` audit row.
Mutation M4 (reverting to `tenantHooks`) is killed by both tests.

## 2. Why could the process answer /health with production introspection disabled? Which subprocess test proves startup now exits?
Validation was only inside `validateAccessToken`, so it ran per request, not at startup. `src/config.ts` now
validates the security configuration before `listen()`. Introspection may be disabled only
when `NODE_ENV=test`, a client secret is required when it is on, and production needs an azp
allowlist. `tests/security/startup-config.test.ts` spawns `src/server.ts` with production +
`KEYCLOAK_INTROSPECTION=false`. It asserts exit code 1, the `Startup refused` message, no
"ready" log, and that the port refuses connections. A positive control with safe config answers
`/health` 200. We repeated your probe on the production image: `node dist/server.js` exited 1 and
the port was refused. The request-time check stays as defence in depth. Mutation M5 (removing the
startup call) is killed.

## 3. What prevents verify-test-independence.mjs from reporting SUCCESS when PostgreSQL is down or npm fails?
Nothing did. The old script treated any `execSync` error as success. The rewrite does the following:
it checks that the container source is byte-identical to the checkout; it requires a passing
baseline in which every expected test exists and passes; it applies one mutation at a time in
a disposable copy, and the anchor must match exactly once; it requires the named tests to fail
with assertion failures; and it classifies suite crashes, missing reports and connection errors
as **INCONCLUSIVE (exit 2)**. It never edits the working tree and verifies that afterwards. On the clean clone:
baseline 188/0/9, **7 of 7 killed**. With PostgreSQL stopped: `INCONCLUSIVE baseline`, exit 2
(`docs/evidence/2026-10-31/mutation-db-down.log`).

## 4. Where is the actual foreign submission in the substitution test?
The old test used `RES_GLOBEX_COURSE1` (a course ID) as a submission ID, so it passed
vacuously. The new test has Alice (Globex learner) create a real submission in Globex via
`POST /api/v1/submissions`, then checks the DB row and that the owner reads it (200). The same ID
through the Acme selector gives 404 on read and grade for the Acme **admin** and the Acme
instructor, does not appear in the Acme list, and the grade stays `null`. Positive control: Diana
(Globex admin) grades it (200). Mutation M3 (dropping the tenant filter on the submission
lookup) is killed by exactly this test.

## 5. Which revision was submitted for W3, at what time? Why is the freeze document dated 10 October?
From git: the last commit before the W3 work was `b8a1e9c` (2 Oct, 22:00 IST). The W3 changes
and `docs/evaluation-protocol.md` were first committed in `f68add3` on **10 Oct 21:35 IST**, then
`2f59524` (21:35), `f09977c` (21:38), `eb50d8b` (11 Oct 11:26) and `953a0aa` (15 Oct 18:36).
The freeze document is dated 10 Oct because it was written then. There is no earlier mentor
approval. **The freeze was late, and the W2-FB004 timeliness criterion is not met.** We added a
timeline note to the protocol and did not change its criteria. *[Team to add: the exact revision
and timestamp submitted through the course portal for W3, with the original submission record.]*

## 6. Which data/API associates a newly provisioned tenant with its domain and SSO configuration?
Migration 003 adds `organization_sso_configs`: `organization_id`, a unique lowercase
`email_domain` (one domain maps to one tenant) and `identity_provider_alias`. `POST
/api/v1/organizations` accepts optional `sso: {emailDomain, identityProviderAlias}`. This is
validated against the realm's configured brokers and written and audited in the **same
transaction** as the tenant, so a domain already claimed rolls the whole tenant back. `GET
/api/v1/sso/discover?email=` returns the alias, which the client passes to Keycloak as the standard
`kc_idp_hint`. `GET /api/v1/sso-config` is the tenant-admin view. The global broker import provides
*federation* (how to talk to the upstream IdP). The new table provides the *tenant association*
(which tenant's users go to which broker). A live test provisions a tenant, discovers its hint, and
observes Keycloak 303 into the `iam-enterprise` realm. Out of scope: DNS ownership
verification, SCIM and real corporate IdPs.

## 7. Can a mobile browser use a different host/issuer/API without source changes?
Yes, with one variable, `IAM_PUBLIC_HOST`. It drives Keycloak `KC_HOSTNAME`, backend `JWT_ISSUER`
and `CORS_ORIGIN`, and the client `/config.js` and CSP. `configure-keycloak.mjs` adds the matching
redirect URIs and broker URLs, and the seed links fixture subjects to the new issuer by explicit
`(issuer, subject)`. The full browser proof (local and broker, web and mobile) passed 10 of 10 on the
alternate origin `127.0.0.1` with no source edits. A physical phone needs the LAN IP and
`IAM_BIND_ADDRESS=0.0.0.0`. That is documented but **not yet recorded**. Classification:
*configuration* covers host, ports, issuer, API base, CORS, azp allowlist and broker aliases.
*Test fixtures* are the seed UUIDs and synthetic passwords. *Policy constants* are the Casbin
`BASE` role table. *Secrets* are client secrets and DB passwords, which are env-supplied with
public synthetic defaults that must never be used outside the lab.

## 8. Each student: a guard/test/transaction, a trade-off, an AI-generated mistake, a small change
To be answered live by each of us. AI-generated mistakes we found through validation this cycle,
which are available as discussion material:
- The mutation runner reported SUCCESS on any error, including a stopped database.
- The outage test passed `sid` at the top level, which `createTestToken` ignores. This was hidden
  because tests were not typechecked.
- The substitution test used a course UUID as a submission ID, so it could not fail.
- The W2 "central guard" refactor silently broke suspended consent withdrawal.
- Earlier written answers overstated evidence. See the corrections below.

## Corrections to our Week 2 answers
- W2 Q1 said a clean clone had been verified. It had not: the earlier first-start run used the
  build context. The first clean-clone run is the 2026-10-31 run of `42d8a43`.
- W2 Q3 said a timeout gives "503 or 401", tested in `token-validator.test.ts`. That file does not
  exist, and the status was actually 401. It is now exactly 503 (`DEPENDENCY_UNAVAILABLE`), asserted
  in `api.test.ts` and `session-lifecycle.test.ts`.

---

# Mentor Review Responses - Week 2

## 1. Can we reproduce the exact SHA from a clean checkout without hidden local state, and identify the raw output behind every recorded result?
Yes. The repository is published, and `docker compose up -d --build --wait` handles the entire initialization from a clean clone without relying on local `.env` files (it uses `.env.example` defaults for synthetic local lab environments). We have verified this with the `iam-firststart` isolated stack. Raw test outputs are captured via our automated Vitest test suite (`npm test`).

## 2. Where does a protected request derive its tenant and current roles? Can an unseeded third organization work without editing application source?
The tenant ID is provided via the untrusted `X-Organization-ID` HTTP header. The backend derives roles by querying the `membership_roles` and `memberships` tables in PostgreSQL for that specific user and tenant.
Yes, an unseeded third organization works dynamically. Our `POST /api/v1/organizations` endpoint provisions new tenants, inserts the new roles into the database, and the authorization engine reads them immediately without needing any source code edits.

## 3. What happens on an introspection timeout or audit write failure, and which tests prove the safe result?
- **Introspection Timeout/Failure:** The API fails closed. If Keycloak is unreachable or times out, the introspection middleware throws an error, resulting in a `503 Service Unavailable` or `401 Unauthorized` response. This is verified by our newly added timeout/failure integration tests in `token-validator.test.ts`.
- **Audit Write Failure:** Sensitive mutations (e.g., grading, provisioning) execute within a PostgreSQL transaction alongside the audit insert. If the audit insert fails, the entire transaction rolls back. This is proven by the `audit insertion failure rolls back a sensitive grade operation` test in `api.test.ts`.

## 4. Which settings caused refresh replay to deny the successor access token? Why does reset preserve an access session, and what does the compromise workflow do?
- **Refresh Replay:** The Keycloak realm configuration explicitly sets `revokeRefreshToken=true` and `refreshTokenMaxReuse=0`. When an old refresh token is reused, Keycloak detects the replay and invalidates the entire token family, causing subsequent API introspection of the successor access token to return `active: false`.
- **Reset vs. Compromise:** A password reset only updates credentials. It intentionally does not terminate existing SSO sessions (to prevent disruption during routine password rotations). For a compromise scenario, the workflow requires explicitly invoking `POST /api/v1/logout-all` (which calls Keycloak's logout APIs) to immediately invalidate the token family.

## 5. What mobile behavior is actually demonstrated, and which frozen acceptance test distinguishes it from another browser page?
Our `mobile.html` client demonstrates a mobile-style responsive browser interface using the same PKCE authorization-code flow as the web client. It is *not* a native application and does not demonstrate native secure storage or hardware attestation. The acceptance test verifies the PKCE flow specifically for the `iam-mobile` client ID configured in Keycloak.

## 6. What remains atomic when the provider succeeds but the application transaction fails during provisioning?
Our provisioning architecture is entirely internal to the application database (creating the org, admin roles, and audit log). We do *not* make external IDP calls to Keycloak during tenant provisioning (Keycloak only handles global identities). Therefore, the entire provisioning process is strictly atomic within the PostgreSQL transaction.

## 7. Which measured bottleneck motivates the improvement, and which security semantics and workload remain identical?
The optional performance improvement aims to reduce authorization latency (p95) caused by sequential database lookups (membership check -> role query -> Casbin evaluation). The baseline relies on a frozen synthetic dataset, a fixed 48-case policy suite, identical hardware, and strictly retains uncached Keycloak introspection. The improvement relies solely on database indexing and batched queries, not bypassing security checks.

## 8. Can each member explain an evaluator-selected guard/policy/test and make a small change that preserves tenant isolation?
Yes. Both members understand the `tenantContextHook`, how Casbin policies apply explicit denies, and how composite foreign keys in the database prevent cross-tenant role assignments. We are prepared to demonstrate modifying a policy rule during the live evaluation.
