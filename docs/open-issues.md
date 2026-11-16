# Open issues (unresolved work at the final submission)

These are the items the Project Report (§8–§9) lists as partial or missing. Each one is meant to be
a GitHub issue. Run `scripts/create-github-issues.ps1` once after `gh auth login`; it creates them
in this order. The report and this file then link to
https://github.com/krishnateja2314/iam-provider/issues.

| # | Title | Area | Done when |
|---|---|---|---|
| 1 | Independent second-machine reproduction and CI | evaluation | A second machine and a CI job run `evaluation/run-clean-evaluation.ps1` and get 253/0/0, 15/15 mutations, and the same E1 verdicts |
| 2 | Audited agent-grant and delegation administration API | enhancement, agents | Tenant admins can grant/revoke AG01 actions and list/revoke all AG02 delegations; audited; a mutation for each new guard is killed |
| 3 | Policy rule delete/list API | enhancement, authorization | `DELETE`/`GET /api/v1/policies` with audit and tests |
| 4 | RFC 8693 token exchange for AG02 | enhancement, agents | An exchanged token with an `act` claim is accepted; revoking the delegation record still gives 401 on the next request |
| 5 | SCIM 2.0 `/Users`, `/Groups` and DNS verification of SSO domains | enhancement, provisioning | SCIM compliance tests pass; a deprovisioned user's next request is 403; an unverified domain cannot be claimed |
| 6 | Production hardening: TLS, managed secrets, rate limits, immutable audit sink | security | Deployed over HTTPS with rotated secrets; browser proof 11/11 against it; audit rows are hash-chained or exported write-once |
| 7 | In-flight authorization consistency policy | security | A documented and tested rule for operations already authorized when a revocation lands |
| 8 | Native mobile clients and iOS testing | enhancement, clients | A native client uses the system browser + app links + secure storage; PKCE login and revocation are tested on Android and iOS |
| 9 | Concurrency / throughput benchmark of the authorization path | evaluation, performance | A reproducible load test (fixed workload, hardware, and policy suite per frozen criterion 6) with introspection still enabled |
