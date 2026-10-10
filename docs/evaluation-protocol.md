# Protocol Freeze and Evaluation Criteria
## Date: 2026-10-10
## Status: Changed & Reaffirmed

### Freeze Decision
The evaluation protocol and core security baseline are formally **frozen** as of Oct 10, 2026. 

### Acceptance & Evaluation Criteria
1. **Repository Access:** The repository is available at the provided URL. A clean clone `docker compose up -d --build` must start all services successfully.
2. **Tenant Isolation:** Active membership must be verified on every request. Modifying the `X-Organization-ID` header must not expose resources from tenants where the user lacks membership.
3. **Provider Lifecycle:**
   - **Password Reset:** Changing a password does *not* automatically revoke active access tokens. Incident response *must* trigger a `logout-all` explicitly.
   - **Refresh Replay:** Reusing an old refresh token must invalidate the successor refresh token and render the successor access token inactive via API introspection.
   - **Introspection:** Introspection is strictly enforced. It cannot be disabled in production (`NODE_ENV=production`), failing closed if configured unsafely.
4. **Provisioning Atomicity:** Organization creation, role assignment, and audit logging must occur within a single database transaction. IdP interactions (if any) occur post-transaction.
5. **Mobile Client Acceptance:** The mobile client (`mobile.html`) represents a *mobile-style responsive browser interface*, not a native mobile application. Native secure storage and hardware attestation are explicitly out of scope.
6. **Performance Optimization (Optional W8):** Any performance optimization (e.g., composite indexes) must be measured against a strict reproducible baseline. The baseline workload, hardware, and policy suite must remain frozen during the comparison. Introspection cannot be disabled to manufacture a performance gain.

*Signed, Team P01-G33*
