# IAM Provider - Mentor Submission

Prepared: 2026-10-03. This package contains a runnable academic prototype and its
current implementation, security and demonstration documentation.

Project: **A Secure Multi-Tenant Identity, Authorization and Enterprise Access Platform**.
The repository name is `iam-provider`, but the project integrates Keycloak; it does
not implement a custom identity provider.

## Submitted Repository and Revision

- Repository: https://github.com/krishnateja2314/iam-provider
- Branch: `main`
- Submitted commit: `b8a1e9cf08d513fbe2bf815914d0587a7ee6bdcb`
- Commit URL: https://github.com/krishnateja2314/iam-provider/commit/b8a1e9cf08d513fbe2bf815914d0587a7ee6bdcb
- Source ZIP: `iam-provider-source-b8a1e9c.zip`
- Documentation ZIP: `iam-provider-documentation-b8a1e9c.zip`

Both archives are generated from the submitted Git commit, not from arbitrary
working-directory files. The local Git commit and GitHub main revision were checked
and matched during package preparation. No application code was changed for packaging.

## What Is Included

| File | Contents | Reviewer use |
|---|---|---|
| `SUBMISSION_README.md` | This cover note, commit, evidence summary and reading order | Read first |
| `iam-provider-source-b8a1e9c.zip` | Backend, tests, migrations, seed, clients, realm imports, Compose, lockfile and documentation | Extract and run the prototype |
| `iam-provider-documentation-b8a1e9c.zip` | README and current Markdown documents | Read without navigating the source tree |
| `SHA256SUMS.txt` | SHA256 hashes of both archives | Check archive integrity |
| `iam-provider-docs/` | Already extracted individual Markdown documents | Upload as a readable documentation folder |

The documentation archive contains:

| Path inside `iam-provider-docs/` | Purpose |
|---|---|
| `README.md` | Reproducible setup, addresses and security contract |
| `docs/repository-report.md` | Main implementation report: architecture, modules, identity model, security decisions, mentor questions and AI-assistance disclosure |
| `docs/demo-guide.md` | Step-by-step demo: commands, clicks, expected results, explanations and troubleshooting |
| `docs/verification-evidence.md` | Dated actual execution results and limitations |
| `docs/traceability-matrix.md` | T01-T13 requirement/test/evidence mapping |
| `docs/domain-model.md` | Entities, cardinalities, keys and tenant constraints |
| `docs/threat-model.md` | Threats, invariants, mitigations and residual risks |
| `docs/adr/ADR-001-identity-provider.md` | Keycloak selection and provider/application ownership rationale |
| `docs/adr/ADR-002-authorization-engine.md` | Keycloak policy/Casbin comparison and chosen authorization approach |

The source archive also contains those documents; the separate documentation ZIP
is provided for convenient review rather than additional implementation evidence.

## Recommended Reading Order

1. This submission note and the main repository report.
2. Verification evidence and requirements traceability.
3. Architecture decisions, domain model and threat model.
4. Demo guide, followed by the runnable source and tests.

## Implementation Summary

- Modular TypeScript/Fastify backend with PostgreSQL.
- Keycloak26.8.0 for OIDC login, federation, signing keys, token issuance and supported lifecycle operations.
- Casbin5.51.1 for declarative authorization with explicit deny precedence.
- Global users separate from external issuer/subject identities and organization memberships.
- Two synthetic organizations with different roles for the same user across tenants.
- Web and mobile-style public clients using authorization-code + S256 PKCE.
- Synthetic enterprise OIDC broker login.
- Strict API access-token verification and uncached provider introspection.
- Active tenant checks, resource ownership, filtered lists and unpublished-resource restrictions.
- Actual submission APIs with ownership/teaching checks and grading.
- Versioned migrations and database-enforced tenant consistency.
- Transactional, concurrent idempotent organization provisioning and administrator bootstrap.
- Membership/resource quotas and organization suspension/reactivation.
- Purpose-specific consent, withdrawal and allowlisted profile fields.
- Queryable allow/deny audit and rollback of sensitive local mutations when audit insertion fails.

## Actual Test Evidence

These results were executed on **2026-10-02**, not rerun or invented during this
2026-10-03 packaging step. Details are in `docs/verification-evidence.md`.

| Check | Recorded result |
|---|---|
| Complete automated suite, live tests enabled | 159 passed,0 failed,0 skipped across7 suites |
| Default fixture suite, live tests not enabled | 153 passed,6 intentionally skipped,0 failed |
| Typecheck and production build | Passed |
| npm audit at verification time | 0 reported vulnerabilities |
| Real browser PKCE/local/enterprise/tenant/session proof | Passed using installed Microsoft Edge through Playwright |
| Separate new-volume startup and browser proof | Passed; original databases preserved |

Default fixture tests use real PostgreSQL and the production validator with locally
signed JOSE tokens. Live lifecycle cases separately use real Keycloak-issued tokens
and call the running API. Browser proof is additional evidence, not part of the159
Vitest test count. A skipped test is not a passed test.

Important observed lifecycle behavior:

- Logout, own-session revoke and logout-all denied subsequent existing-token API requests.
- Final measured operation-to-first-denial durations were62/65/38ms across three local samples, not a universal SLA.
- Refresh replay rejected both reused and successor refresh tokens and denied successor access before explicit logout.
- Password reset rejected old credentials and accepted new credentials, but did **not** revoke the already-issued session. Incident response must also use logout-all.

## Run the Submitted Source

Extract the source ZIP. Open a terminal inside its `iam-provider` folder, then:

```powershell
docker compose up -d --build --wait
docker compose ps
```

Prerequisites: Docker Desktop with Linux containers. Host Node24+ is additionally
needed for the configuration/browser scripts, not for ordinary backend startup.

| Service | Local URL |
|---|---|
| Web demo | http://localhost:5173/web.html |
| Mobile-style demo | http://localhost:5173/mobile.html |
| API | http://localhost:3100 |
| Keycloak | http://localhost:8180 |

Synthetic Alice login is `alice` / `alice123`. Use the demo guide for the other
fixtures, organization selection and positive/negative scenarios. These are deliberately
public development fixtures, not real credentials. Database ports remain private.

Default tests:

```powershell
docker compose exec -T backend env KEYCLOAK_INTROSPECTION=false RUN_DATABASE_TESTS=1 npm test
```

Expected fixture result:153 passed,6 deliberately skipped live cases. Follow section10
of the demo guide to enable the test-only client, run all159 tests, and disable that
client afterward. That command's child-process environment does not disable
introspection in the running production API process.

Do not delete volumes to apply configuration. First-start evidence was obtained
using separate new volumes and the current build context; an independent clone-based
verification was not part of that earlier test run.

## Honest Scope Boundaries

This is a synthetic academic prototype, not a production security certification.
Mobile means a responsive browser client, not a native application. Enterprise
federation uses synthetic realms, not a real company domain/IdP integration.
Provider sessions are not hardware-device attestation.

Optional application machine identities, user delegation, full SCIM, native device
integration and the optional controlled performance experiment remain deferred.
The provider-admin infrastructure service account is not the application's optional
agent feature. Local HTTP and development credentials must not be deployed publicly.

Local `.env` files, private backups, tokens, dependencies, compiled output and
historical personal TeX/PDF submissions are excluded from the source archive.
Older design reports are not substituted for current implementation/test evidence.

## Student Understanding and AI Disclosure

Material AI assistance was used for implementation and documentation, as disclosed
in the main report. Both students should be able to explain the authentication hook,
tenant checks, authorization adapter, provisioning transaction, consent projection
and an evaluator-selected test. Test execution is evidence of observed behavior,
not a substitute for student understanding or independent security review.

## Drive Upload Checklist

1. Upload this note, both ZIPs, and `SHA256SUMS.txt` into the mentor's assigned folder.
2. Upload the already extracted `iam-provider-docs/` folder as well for easy individual document access; the documentation ZIP is the matching portable copy.
3. Ensure the mentor can open the GitHub repository; a private repo needs collaborator access.
4. Use the submitted commit above when identifying this exact submission.
5. Add a genuine screenshot/video only if the mentor explicitly requires it; none is fabricated by this package.
6. If the Drive folder has an additional naming/PDF/template requirement, follow it; no such template was supplied here.
