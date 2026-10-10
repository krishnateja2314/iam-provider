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
