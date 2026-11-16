# Creates the open-work issues listed in docs/open-issues.md. Run once, after `gh auth login`,
# from the repository root:  powershell -ExecutionPolicy Bypass -File scripts\create-github-issues.ps1
$repo = "krishnateja2314/iam-provider"
$issues = @(
  @("Independent second-machine reproduction and CI", "enhancement", "Run evaluation/run-clean-evaluation.ps1 on a second machine and in CI. Done when both produce 253/0/0, 15/15 mutations and the same E1 verdicts. See Project Report section 9, task 1."),
  @("Audited agent-grant and delegation administration API", "enhancement", "AG01 grants are seed/DB-only; tenant admins cannot list or revoke other users' AG02 delegations. Done when audited endpoints exist with tests and a killed mutation for each new guard. ADR-013/ADR-014."),
  @("Policy rule delete/list API", "enhancement", "POST /api/v1/policies can add allow/deny rows but they cannot be listed or deleted through the API. Done when DELETE/GET exist with audit and tests. ADR-003."),
  @("RFC 8693 token exchange for AG02", "enhancement", "AG02 uses X-Delegation-ID instead of a standard exchanged token. Done when an exchanged token with an act claim is accepted and revoking the delegation record still gives 401 on the next request. ADR-014."),
  @("SCIM 2.0 /Users, /Groups and DNS verification of SSO domains", "enhancement", "M5 is a minimal provisioning slice. Done when SCIM compliance tests pass, a deprovisioned user's next request is 403 and an unverified domain cannot be claimed. ADR-008."),
  @("Production hardening: TLS, managed secrets, rate limits, immutable audit sink", "enhancement", "The lab runs HTTP with public synthetic secrets; audit is an ordinary table. Done when deployed over HTTPS with rotated secrets, browser proof 11/11 passes against it, and audit rows are hash-chained or exported write-once."),
  @("In-flight authorization consistency policy", "enhancement", "Revocation applies from the next request; an already-authorized in-flight operation may complete. Done when a rule is documented and tested."),
  @("Native mobile clients and iOS testing", "enhancement", "The mobile client is a responsive browser page (ADR-009). Done when a native client uses the system browser, app links and secure storage, and PKCE login and revocation are tested on Android and iOS."),
  @("Concurrency / throughput benchmark of the authorization path", "enhancement", "Only sequential latency was observed. Done when a reproducible load test with fixed workload, hardware and policy suite (frozen criterion 6) is published, with introspection still enabled.")
)
foreach ($i in $issues) {
  gh issue create --repo $repo --title $i[0] --label $i[1] --body $i[2]
}
