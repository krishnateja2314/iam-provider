# Presentation Guide: How To Run the Demo and Explain the Project

This is the plain-English companion to [demo-guide.md](demo-guide.md). That file is the
complete evaluator reference, with every test command. This file is for **presenting**:
what to set up, what to click, what appears on screen, and what to say at each step.
Read it once end to end, then rehearse with the stack running.

---

## 1. The project in 30 seconds

**The problem.** A learning platform serves many organizations (tenants). One person
can belong to several of them with a different role in each. Alice is an **admin at
Acme Learning Corp** and a **learner at Globex University**. Her Acme admin powers must
never work inside Globex. Many systems get this wrong through five shortcuts:

1. trusting the organization ID the client sends,
2. putting roles inside the login token, where they go stale,
3. merging accounts because two emails match,
4. trusting a JWT until it expires, so logout doesn't really log anyone out,
5. treating audit logging as an afterthought.

**What we built.** A multi-tenant identity and access platform that avoids all five,
and tests that actively try to break it.

- **Keycloak 26.8.0** handles *authentication* (who you are): login, PKCE, token
  signing, refresh rotation, and the enterprise SSO broker.
- **Our backend** handles *authorization* (what you may do in **this** organization):
  memberships, tenant roles, Casbin policy, provisioning, consent, and audit.
- **Shape:** a modular monolith, meaning one Fastify process, one PostgreSQL database,
  and five Docker containers in total.

**Proof.** 159/159 tests pass (16 of them against a live Keycloak). After logout, the
old token is rejected on the very next request, 38–65 ms later. A separate script
deliberately breaks the guards and confirms the tests then fail.

---

## 2. Before you present (15 minutes ahead)

1. Start **Docker Desktop** and wait until it says it's running.
2. From the repository root:

   ```powershell
   docker compose up -d --build --wait
   docker compose ps
   ```

   You should see five healthy services: `backend`, `clients`, `keycloak`,
   `postgres`, `keycloak-db`. The first build takes a few minutes; later starts are fast.

3. Open these tabs **in this order**:

   | Tab | Address | Why |
   |---|---|---|
   | 1 | http://localhost:5173/web.html | Main demo |
   | 2 | http://localhost:5173/mobile.html | Second client (Bob) |
   | 3 | http://localhost:3100/health | Shows the API is up |
   | 4 | `docs/verification-evidence.md` | Backup evidence if the live demo fails |

4. **Dry run:** log in as Alice, click one endpoint, then **Sign out**. If that
   works, everything works.
5. Close anything that shows tokens, `.env` files or terminal history with secrets.
   Zoom the browser to about 125% so people at the back can read it.

> **Never run `docker compose down -v`.** It deletes the database volumes. Use
> `docker compose down` (without `-v`) to stop the stack.

---

## 3. A tour of the UI (know what you are pointing at)

The client page has a top bar and three numbered panels.

| Area | What it shows | What to say about it |
|---|---|---|
| **Top bar pill** | Session state: grey = signed out, green = signed in, red = last request denied, amber = working | "This is the client's view of the session." |
| **01 Session** | Sign-in buttons, then your **internal user ID** and one card per **membership**, with role badges. The selected organization's card gets an orange edge. | "One global user, two memberships, a different role in each." |
| **02 Request** | The `X-Organization-ID` header selector, and one button per API endpoint (`GET /members`, and so on) | "This header is the only thing that changes. The backend treats it as untrusted." |
| **Verdict panel** | A big status code: **200 Allowed** in green, **403 Denied** or **404 Not found in this tenant** in red, plus the request and a one-line reason | "This is the backend's decision, explained." |
| **Rows** | The response rendered as a list, scoped to the organization | "Notice everything here belongs to this tenant only." |
| **Raw JSON response** | Click it to expand the exact API response | Use it if someone asks "is that real?" |
| **03 Decision log** | Every request this session, newest first, with its status code | "Same person, same token: 200 here, 403 there." |

Tokens are never displayed anywhere on the page. That is deliberate.

---

## 4. The demo, step by step (about 5 minutes)

Split the steps between the two presenters: **Presenter A** drives the keyboard,
**Presenter B** narrates. Swap roles at Part C.

### Part A: Login without the app seeing a password (about 1 min)

1. On the **web** tab, click **Sign in with Keycloak**.
2. The browser goes to the Keycloak login page. Enter `alice` / `alice123`.
3. You return to the client. The pill turns green: **Signed in**. The Session panel
   shows two memberships: **Acme Learning Corp, `admin`** and **Globex University, `learner`**.

**Say:**
> "The password went to Keycloak, not to us. This is the authorization-code flow
> with PKCE. The browser keeps a secret verifier, so even if someone steals the
> login code from the redirect, it's useless to them. And look: one person,
> two organizations, with a different role in each."

### Part B: The money moment, same person in a different tenant (about 2 min)

| # | Do this | You will see | Say |
|---|---|---|---|
| 1 | Select **Acme Learning Corp** in `X-Organization-ID` and click `GET /members` | Green **200 Allowed** and a list of Acme members | "Alice is admin here, so she can manage members." |
| 2 | Switch the selector to **Globex University** | An amber **↺ Switched to Globex University** message | "Nothing is cached. The next request is re-checked from scratch." |
| 3 | Click `GET /members` | Red **403 Denied** | **Pause here.** "Same person, same token, different organization. Her Acme admin role does not cross over." |
| 4 | Click `GET /resources` | **200**, and only Globex's published courses | "She can still do learner things here, and only with Globex data." |
| 5 | Point at the **Decision log** | 200 at Acme, then 403 at Globex | "That contrast is the whole project in one picture." |

**Say (while the 403 is on screen):**
> "The organization arrives in a header that the client controls, so we never trust
> it. On every request the backend re-reads Alice's membership and her roles for
> *that* organization from the database, then asks Casbin. Every database query also
> filters by organization, so even a guessed ID from another tenant returns 404."

### Part C: Audit (about 30 s)

1. Switch back to **Acme**, then click `GET /audit-events`.
2. You see **200** and rows such as `member.manage · allow` and `resource.list · allow`.
   Each row has a time, a reason and a correlation ID.

**Say:**
> "Every decision is recorded, both allows and denies. For changes like grading, the
> change and its audit row commit in the same transaction. If the audit write fails,
> the grade is rolled back too. No silent changes."

### Part D: Instructor boundary on the mobile client (about 1 min)

1. On the web tab, click **Sign out**. Wait until the pill says **Not signed in**.
2. Go to the **mobile** tab and click **Sign in with Keycloak**. Enter `bob` / `bob123`.
3. Select Acme, then click `GET /submissions`. **200**, but only submissions from the course Bob teaches.
4. Click `GET /members`. **403**.

**Say:**
> "Bob is an instructor. A role alone isn't enough to see submissions; the backend
> also checks that he actually teaches that course. And he can't manage members,
> because that's admin-only. This mobile page is a separate Keycloak client. It's a
> responsive web page, not a native app; we're upfront about that."

### Part E (optional, if time allows): Sessions

1. Click **Rotate refresh token**. The pill says *refresh token rotated*.
2. Click `GET /sessions`. It shows Bob's Keycloak sessions.

**Say:**
> "Keycloak rotates refresh tokens. If an old one is ever replayed, our tests show
> Keycloak kills the whole chain: the old token, its successor, and the access token."

---

## 5. Explaining one request end to end

If asked "what actually happens when I click a button?", walk through these four gates in order:

1. **Verify the token.** Check the RS256 signature, issuer, audience `iam-backend`,
   expiry, and `typ=Bearer` (an ID token is rejected with 401). Then ask Keycloak live,
   with no cache, whether the session is still active. If Keycloak can't be reached,
   the request fails closed.
2. **Tenant context.** `X-Organization-ID` is untrusted. The user must have an
   **active membership** in an **active** organization, otherwise 403.
3. **Hard boundaries.** Does the resource belong to this tenant? Is it published?
   Does this instructor teach this course?
4. **Casbin decision.** Roles are read fresh from the database. The rule is
   *at least one allow and no deny*, so a deny always wins, even across two roles.

Code to show if asked: `backend/src/middleware.ts` (gates 1–2) and
`backend/src/modules/authorization/authorization-engine.ts` (gates 3–4).

---

## 6. Numbers to quote (exactly these)

| Claim | Number |
|---|---|
| Tests | **159 passed, 0 failed, 0 skipped**, run on 2 Oct 2026 |
| Biggest suite | Authorization: **59** (48 role cases + 11 boundary cases) |
| Token validation cases | **41** |
| Live Keycloak session tests | **16** |
| Logout → old token rejected | **62 ms** logout, **65 ms** revoke one session, **38 ms** logout-all (3 local samples, not an SLA) |
| Dependency audit | `npm audit`: **0 vulnerabilities** |

What testing taught us:
- A **password reset does NOT end existing sessions**. The old token kept returning
  200, so incident response must be *reset the password plus logout-all*.
- **Refresh replay** kills the whole token family: 400 / 400 / 401.
- `scripts/verify-test-independence.mjs` breaks the guards on purpose, and the tests fail.

---

## 7. Likely questions, with short answers

| Question | Answer |
|---|---|
| Why not microservices? | Two people, eight weeks. One process gives us real database transactions and less infrastructure. The module boundaries are kept, so modules can be split out later. |
| Why Keycloak instead of your own login? | A secure login server is a project of its own. We spent our time on tenant authorization, which identity providers leave to the application. |
| Why not put roles in the token? | They'd stay valid until the token expires. We read them fresh from the database on every request. |
| What stops someone from changing the header? | Nothing on the client side. We check membership on every request, and every SQL query filters by organization. |
| PKCE vs state vs nonce? | PKCE makes a stolen code useless. State ties the callback to this browser's login attempt. Nonce ties the ID token to that login. |
| Why reject ID tokens at the API? | They tell the *client* who logged in. They are not permission to call the API. |
| Why not merge accounts by email? | Emails can be unverified or recycled, which risks account takeover. Identity is keyed by (issuer, subject). |
| What if Keycloak is down? | Requests fail closed: denied, never guessed. Introspection can't be turned off in production mode. |
| Can a platform admin read any tenant's data? | No. Platform admin can create and suspend organizations, but tenant access still requires membership. |
| How do you add a third organization? | `POST /api/v1/organizations` with an idempotency key. No code changes needed, and safe to retry. |
| How do you know your tests mean anything? | The mutation script removes the checks and the tests go red. |

---

## 8. What is left (say it confidently, not apologetically)

- **Not built:** AI agent delegation (design: *agent permission = user permission ∩
  delegated scope ∩ tenant*), service accounts, full SCIM, and a p95 performance experiment.
- **Lab setup only:** Keycloak in dev mode over plain HTTP, synthetic passwords, no rate limiting.
- **Mobile** is a responsive web page, not a native app. **Enterprise SSO** is a second
  Keycloak realm, not a real company's identity provider, and there's no SAML.
- **Revocation and role changes** apply from the *next* request. A request already in
  progress can still finish.
- **Audit** can be queried but isn't tamper-proof (no hash chain or write-once storage).

> "We'd rather show you exactly what's proven than overclaim."

---

## 9. Don't fumble

- **Sign out before switching users.** Otherwise Keycloak's single sign-on logs you
  straight back in as the previous person.
- If the wrong user appears anyway, use a **private window**.
- If a login fails with *Invalid or expired login transaction*, you waited more than
  5 minutes on the Keycloak page. Click sign in again.
- If the stack isn't healthy: `docker compose logs backend --tail 40`. If you can't
  fix it in a minute, switch to `docs/verification-evidence.md` and say so honestly.
  **Never** present an old result as a live run.
- Don't say "production-ready", "native app", or "we built our own identity provider".
- Pause on the **403**. It's the moment the audience will remember.

### Who says what

| Presenter A | Presenter B |
|---|---|
| Problem, architecture, PKCE and tokens, sessions and revocation timings | Tenant boundaries, Casbin and deny-overrides, audit, provisioning, limitations |

Both presenters must be able to explain the four-gate request flow in section 5,
because either of you may get that question.
