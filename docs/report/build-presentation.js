// Final presentation deck for Team P01-G33 (CS5903). node build.js <out.pptx>
const pptxgen = require("pptxgenjs");
// Needs pptxgenjs (npm i pptxgenjs@3.12.0) and an applyTheme helper that writes THEME into ppt/theme/theme1.xml;
// set PPTX_APPLY_THEME to its path, or the deck keeps the default Office palette.
const applyTheme = process.env.PPTX_APPLY_THEME ? require(process.env.PPTX_APPLY_THEME).applyTheme : async () => {};
const OUT = process.argv[2] || "deck.pptx";

const THEME = {
  name: "IAM Platform",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1B1F24", lt1: "FFFFFF", dk2: "14213D", lt2: "EEF1F5",
    accent1: "0F7B6C", // teal: allowed / our solution
    accent2: "C8364E", // raspberry: denied / baseline
    accent3: "E09F3E", // amber: highlight
    accent4: "3D5A80", // slate blue
    accent5: "8D99AE", // gray
    accent6: "5B4B8A", // violet
    hlink: "0F7B6C", folHlink: "3D5A80",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pres.author = "Team P01-G33";
pres.company = "IIT Hyderabad";
pres.title = "Secure Multi-Tenant Identity and Access Platform";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

// ---------- layouts
pres.defineSlideMaster({
  title: "DARK", background: { color: C.text2 },
  objects: [],
  slideNumber: { x: 9.2, y: 5.2, w: 0.5, h: 0.3, fontSize: 10, color: C.background2 },
  placeholders: [],
});
pres.defineSlideMaster({
  title: "CONTENT", background: { color: C.background1 },
  objects: [
    { text: { text: "Team P01-G33 · CS5903 · Secure Multi-Tenant IAM", options: { x: 0.5, y: 5.22, w: 6, h: 0.3, fontSize: 10, color: C.accent5, isTextBox: true } } },
  ],
  slideNumber: { x: 9.2, y: 5.22, w: 0.5, h: 0.3, fontSize: 10, color: C.accent5 },
  placeholders: [
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.28, w: 9.0, h: 0.75, fontSize: 30, bold: true, color: C.text2, valign: "top", fontFace: THEME.headFontFace, margin: 0 }, text: "" } },
  ],
});

let sectionTitle = "Opening";
const sec = (t) => { sectionTitle = t; pres.addSection({ title: t }); };
const content = (title, notes) => {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle });
  s.addText(title, { isTextBox: true, x: 0.5, y: 0.3, w: 9.0, h: 0.75, margin: 0, fontSize: 28, bold: true, color: C.text2, valign: "top", fontFace: THEME.headFontFace, objectName: "Title" });
  if (notes) s.addNotes(notes);
  return s;
};
const T = (s, text, o) => s.addText(text, { isTextBox: true, margin: 0, fontSize: 14, color: C.text1, valign: "top", ...o });
const card = (s, x, y, w, h, fill = C.background2, name) =>
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: 0.08, objectName: name });
const badge = (s, x, y, label, fill = C.accent1, d = 0.42) => {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 } });
  s.addText(label, { isTextBox: true, x, y, w: d, h: d, align: "center", valign: "middle", fontSize: 13, bold: true, color: C.background1, margin: 0 });
};
const chip = (s, x, y, w, label, fill) => {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.28, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: 0.14 });
  s.addText(label, { isTextBox: true, x, y, w, h: 0.28, align: "center", valign: "middle", fontSize: 10, bold: true, color: C.background1, margin: 0 });
};
const chartText = { catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", dataLabelFontFace: "+mn-lt", legendFontFace: "+mn-lt", titleFontFace: "+mn-lt" };
const quietAxes = () => ({ catAxisLabelColor: "4A5363", valAxisLabelColor: "4A5363", valGridLine: { color: "E3E6EB", size: 0.75 }, catGridLine: { style: "none" }, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontSize: 11, dataLabelColor: "1B1F24" });

// ================================================================ 1 Title
sec("Opening");
{
  const s = pres.addSlide({ masterName: "DARK", sectionTitle });
  T(s, "CS5903 · IIT HYDERABAD · FINAL PROJECT", { x: 0.6, y: 0.7, w: 8.8, h: 0.3, fontSize: 12, bold: true, color: C.accent3, charSpacing: 2 });
  T(s, "Secure Multi-Tenant Identity and Access Platform", { x: 0.6, y: 1.1, w: 8.8, h: 1.4, fontSize: 38, bold: true, color: C.background1, fontFace: THEME.headFontFace });
  T(s, "Keycloak proves who you are. Our backend decides what you may do, in each organization, on every request, for people and for AI agents.", { x: 0.6, y: 2.6, w: 7.8, h: 0.8, fontSize: 16, color: C.background2, italic: true });
  T(s, [
    { text: "Project 01 · Group 33 (Team P01-G33)", options: { bold: true, breakLine: true } },
    { text: "Krishna Teja (CS23BTECH11028) · Jaya Prakash (CS23BTECH11015)", options: { breakLine: true } },
    { text: "Mentor: Koundinya · Instructor: Prof. Praveen Tammana", options: { breakLine: true } },
    { text: "github.com/krishnateja2314/iam-provider · tag cs5903-final-2026" },
  ], { x: 0.6, y: 3.75, w: 8.5, h: 1.2, fontSize: 13, color: C.background1, paraSpaceAfter: 2 });
  s.addNotes("Hi, we are team P01-G33. We built a secure multi-tenant identity and access platform for a learning SaaS. The one line to remember: Keycloak proves who you are, and our backend decides what you are allowed to do, in each organization, on every request, for people and for AI agents.");
}

// ================================================================ 2 Problem
sec("Problem and motivation");
{
  const s = content("One person, two organizations, very different rights",
    "Meet Alice. At Acme Learning Corp she is an admin: she manages members, reads the audit log and creates courses. At Globex University she is only a learner. Same login, same person. The whole project comes down to one question: when Alice switches to Globex, does any of her Acme power follow her? It must not. And now programs act for users too, so an agent acting for Alice must never be able to do more than Alice.");
  card(s, 0.5, 1.3, 4.35, 2.6, "E7F3F1");
  card(s, 5.15, 1.3, 4.35, 2.6, "F9E8EB");
  T(s, "Acme Learning Corp", { x: 0.8, y: 1.5, w: 3.8, h: 0.4, fontSize: 18, bold: true, color: C.text2 });
  chip(s, 0.8, 1.98, 1.1, "ADMIN", C.accent1);
  T(s, [
    { text: "Manage members", options: { bullet: true, breakLine: true } },
    { text: "Read the audit trail", options: { bullet: true, breakLine: true } },
    { text: "Create and publish courses", options: { bullet: true } },
  ], { x: 0.8, y: 2.45, w: 3.8, h: 1.3, fontSize: 15, paraSpaceAfter: 4 });
  T(s, "Globex University", { x: 5.45, y: 1.5, w: 3.8, h: 0.4, fontSize: 18, bold: true, color: C.text2 });
  chip(s, 5.45, 1.98, 1.25, "LEARNER", C.accent2);
  T(s, [
    { text: "See published courses only", options: { bullet: true, breakLine: true } },
    { text: "See only her own submissions", options: { bullet: true, breakLine: true } },
    { text: "Members, audit: 403", options: { bullet: true } },
  ], { x: 5.45, y: 2.45, w: 3.8, h: 1.3, fontSize: 15, paraSpaceAfter: 4 });
  T(s, "Same login. Nothing from Acme may follow her into Globex, and an AI agent acting for her must never exceed her current rights.", { x: 0.5, y: 4.2, w: 9.0, h: 0.7, fontSize: 16, italic: true, color: C.accent4 });
}

// ================================================================ 3 Shortcuts
{
  const s = content("Five shortcuts that leak access, and our rules",
    "Here is why it usually goes wrong. Apps trust the organization ID the client sends, so changing one header leaks another tenant's data. They put roles in the token, so a removed role keeps working until expiry. They merge accounts by email, which is a takeover risk. They trust the JWT alone, so logout does not really log you out. And audit is an afterthought. The right column is our rule for each one; every rule is implemented and has at least one test that fails if the guard is removed.");
  const rows = [
    ["Trust the tenant ID the client sends", "X-Organization-ID is untrusted; active membership checked every request"],
    ["Put tenant roles in the login token", "Roles read from the database at decision time; no cache"],
    ["Merge accounts with the same email", "Identity = issuer + subject; never merged by email"],
    ["Trust a JWT until it expires", "Uncached introspection: logout works on the next request"],
    ["Audit as an afterthought", "Audit row in the same transaction; it fails, the change rolls back"],
  ];
  T(s, "COMMON SHORTCUT", { x: 1.1, y: 1.2, w: 3.6, h: 0.3, fontSize: 11, bold: true, color: C.accent2, charSpacing: 1 });
  T(s, "OUR RULE (implemented + tested)", { x: 5.0, y: 1.2, w: 4.5, h: 0.3, fontSize: 11, bold: true, color: C.accent1, charSpacing: 1 });
  rows.forEach((r, i) => {
    const y = 1.55 + i * 0.7;
    badge(s, 0.5, y + 0.06, String(i + 1), C.accent4, 0.4);
    card(s, 1.05, y, 3.7, 0.55, "F9E8EB");
    card(s, 4.95, y, 4.55, 0.55, "E7F3F1");
    T(s, r[0], { x: 1.2, y, w: 3.45, h: 0.55, fontSize: 13, valign: "middle" });
    T(s, r[1], { x: 5.1, y, w: 4.3, h: 0.55, fontSize: 13, valign: "middle" });
  });
}

// ================================================================ 4 Milestones
{
  const s = content("Scope: seven milestones and two agent extensions",
    "The brief gave seven milestones: the identity and tenant model, sign-in with enterprise federation, the session lifecycle, fine-grained authorization, provisioning, consent and audit, and M7, proving it all with attack tests. Our mentor added two agent extensions. All are implemented and verified. M5 is honest: we built the agreed minimal provisioning slice, not full SCIM.");
  const items = [
    ["M1", "Identity & tenant model", "Verified"], ["M2", "Sign-in & federation", "Verified"], ["M3", "Session lifecycle", "Verified"],
    ["M4", "Fine-grained authorization", "Verified"], ["M5", "Tenant provisioning", "Minimal slice"], ["M6", "Consent & audit", "Verified"],
    ["M7", "Security validation", "Verified"], ["AG01", "Agent as itself", "Verified"], ["AG02", "Agent acting for a user", "Verified"],
  ];
  items.forEach((it, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.5 + col * 3.05, y = 1.3 + row * 1.2;
    card(s, x, y, 2.85, 1.0, C.background2);
    badge(s, x + 0.15, y + 0.27, it[0], it[0].startsWith("AG") ? C.accent6 : C.accent4, 0.46);
    T(s, it[1], { x: x + 0.75, y: y + 0.14, w: 2.0, h: 0.45, fontSize: 13, bold: true, color: C.text2 });
    chip(s, x + 0.75, y + 0.6, it[2] === "Verified" ? 0.85 : 1.15, it[2], it[2] === "Verified" ? C.accent1 : C.accent3);
  });
}

// ================================================================ 5 Approach
sec("Proposed solution");
{
  const s = content("Approach: cut infrastructure, keep security goals",
    "Our Week 0 plan was too ambitious: eight microservices, our own login server, full SCIM and agents. Our mentor pointed out we would spend the eight weeks on infrastructure instead of proving security. So we switched to a modular monolith, one process and one database, which also gives us real transactions for change plus audit. We let Keycloak do login, and wrote tests with every milestone instead of at the end.");
  const pairs = [
    ["8 separately deployed services", "1 modular monolith (9 modules), one ACID transaction"],
    ["Our own OIDC login server", "Keycloak 26.8.0: PKCE, broker, sessions, signing"],
    ["Full SCIM", "Minimal, idempotent provisioning slice"],
    ["Security tests at the end", "Tests with every milestone, then mutation-checked"],
  ];
  T(s, "WEEK 0 PROPOSAL", { x: 0.5, y: 1.2, w: 3.8, h: 0.3, fontSize: 11, bold: true, color: C.accent5, charSpacing: 1 });
  T(s, "WHAT WE BUILT (ADR-001, 002, 008)", { x: 5.0, y: 1.2, w: 4.5, h: 0.3, fontSize: 11, bold: true, color: C.accent1, charSpacing: 1 });
  pairs.forEach((p, i) => {
    const y = 1.6 + i * 0.85;
    card(s, 0.5, y, 3.9, 0.66, C.background2);
    T(s, p[0], { x: 0.68, y, w: 3.6, h: 0.66, fontSize: 14, valign: "middle", color: "6B7280" });
    s.addShape(pres.shapes.RIGHT_ARROW, { x: 4.5, y: y + 0.18, w: 0.4, h: 0.3, fill: { color: C.accent3 }, line: { color: C.accent3, width: 0 } });
    card(s, 5.0, y, 4.5, 0.66, "E7F3F1");
    T(s, p[1], { x: 5.18, y, w: 4.2, h: 0.66, fontSize: 14, valign: "middle", bold: true, color: C.text2 });
  });
}

// ================================================================ 6 Architecture
sec("Architecture and implementation");
{
  const s = content("Architecture: five containers, one command",
    "The whole system is five containers started with docker compose up. The web and mobile-style clients log in through Keycloak with PKCE, so our app never sees a password. Keycloak can broker to a separate enterprise realm that simulates company SSO. Agents get their own client-credentials tokens. Every caller sends a bearer token and an organization header to our Fastify backend, which introspects the token with Keycloak and keeps memberships, roles, policies and audit in its own PostgreSQL. Neither database exposes a port.");
  const box = (x, y, w, h, title, sub, fill, name) => {
    card(s, x, y, w, h, fill, name);
    T(s, [{ text: title, options: { bold: true, breakLine: true, fontSize: 13, color: C.text2 } }, { text: sub, options: { fontSize: 11, color: "4A5363" } }], { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: h - 0.16, valign: "middle", align: "center" });
  };
  box(0.5, 1.3, 2.3, 0.85, "Web / mobile client", "public OIDC, PKCE S256", "E8EDF5");
  box(0.5, 2.45, 2.3, 0.85, "Agents AG01 / AG02", "client credentials, 60 s", "EFEBF7");
  box(3.85, 1.3, 2.4, 0.85, "Keycloak 26.8.0", "login, tokens, sessions", "FCF3E4");
  box(7.3, 1.3, 2.2, 0.85, "Enterprise realm", "synthetic company IdP", "FCF3E4");
  box(3.85, 2.75, 2.4, 1.05, "Fastify backend", "modular monolith: 4-stage request path", "E7F3F1");
  box(7.3, 2.75, 2.2, 1.05, "PostgreSQL 16", "tenant-filtered, audit in same txn", "E8EDF5");
  box(3.85, 4.2, 2.4, 0.7, "Keycloak DB", "private network", C.background2);
  const line = (x, y, w, h, opts = {}) => s.addShape(pres.shapes.LINE, { x, y, w, h, line: { color: C.accent4, width: 1.5, endArrowType: "triangle", ...opts } });
  line(2.8, 1.72, 1.05, 0, {});
  T(s, "login (PKCE)", { x: 2.85, y: 1.42, w: 1.0, h: 0.25, fontSize: 9, color: "4A5363" });
  line(6.25, 1.72, 1.05, 0, {});
  T(s, "broker", { x: 6.4, y: 1.42, w: 0.8, h: 0.25, fontSize: 9, color: "4A5363" });
  line(2.8, 2.88, 1.05, 0.2, {});
  T(s, "Bearer + X-Organization-ID", { x: 1.2, y: 3.4, w: 2.6, h: 0.3, fontSize: 9, color: "4A5363", align: "right" });
  line(5.05, 2.75, 0, -0.6, { dashType: "dash" });
  T(s, "introspect (no cache)", { x: 5.15, y: 2.3, w: 1.6, h: 0.25, fontSize: 9, color: "4A5363" });
  line(6.25, 3.27, 1.05, 0, {});
  T(s, "docker compose up -d --build --wait  →  5 healthy services in about 70 s", { x: 6.5, y: 4.3, w: 3.0, h: 0.6, fontSize: 11, italic: true, color: C.accent4 });
}

// ================================================================ 7 Request path
{
  const s = content("Every request passes four checks, in order",
    "Every protected request passes four checks. One: verify the token: signature, issuer, audience, expiry and that it is an access token, then a live introspection call. Fail and it is 401, or 503 if Keycloak is down, never allow. Two: tenant context. The organization header is untrusted, so we require an active membership in an active organization, or for agents a grant or a delegation. Three: hard boundaries: is the resource in this tenant, is it published, does this instructor teach this course, is this the delegated scope? Four: Casbin makes the final decision with deny-overrides. Underneath, every query filters on the organization, so a guessed ID from another tenant just returns 404.");
  const steps = [
    ["1", "Verify token", "RS256, issuer, audience, expiry, typ=Bearer + uncached introspection", "401 / 503"],
    ["2", "Tenant context", "X-Organization-ID must match an active membership, AG01 grant or AG02 delegation", "403"],
    ["3", "Hard boundaries", "tenant ownership, published-only, teaches-course, owns-submission, delegated scope", "403 / 404"],
    ["4", "Casbin decision", "current roles, baseline + tenant policy rows, deny overrides allow", "403"],
  ];
  steps.forEach((st, i) => {
    const x = 0.5 + i * 2.3;
    card(s, x, 1.35, 2.1, 2.75, i === 3 ? "E7F3F1" : C.background2);
    badge(s, x + 0.15, 1.5, st[0], C.accent1, 0.46);
    T(s, st[1], { x: x + 0.15, y: 2.05, w: 1.85, h: 0.35, fontSize: 15, bold: true, color: C.text2 });
    T(s, st[2], { x: x + 0.15, y: 2.45, w: 1.85, h: 1.15, fontSize: 12, color: "374151" });
    chip(s, x + 0.15, 3.68, 1.0, st[3], C.accent2);
    if (i < 3) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + 2.12, y: 2.6, w: 0.16, h: 0.26, fill: { color: C.accent3 }, line: { color: C.accent3, width: 0 } });
  });
  T(s, "Underneath: every query filters on organization_id, so a guessed ID from another tenant returns 404, not data.", { x: 0.5, y: 4.35, w: 9.0, h: 0.5, fontSize: 14, italic: true, color: C.accent4 });
}

// ================================================================ 8 Authorization
{
  const s = content("Authorization: roles, attributes, relationships",
    "Authorization combines three models in one decision path. Roles, through Casbin. Attributes, like published versus draft. And relationships, like instructor teaches course, read at decision time as in Zanzibar but at small scale. The effect is deny-overrides: an allow needs at least one matching allow and no matching deny across all of the user's current roles. A tenant admin can add a deny row and it wins even against a baseline admin allow. 59 policy scenarios are tested; the brief asked for 40.");
  const cols = [
    ["RBAC", "Roles per tenant", "admin / instructor / learner, read fresh each request"],
    ["ABAC", "Attributes", "learners see published courses only"],
    ["ReBAC", "Relationships", "instructor teaches course; learner owns submission"],
  ];
  cols.forEach((c, i) => {
    const x = 0.5 + i * 3.05;
    card(s, x, 1.3, 2.85, 1.65, C.background2);
    T(s, c[0], { x: x + 0.2, y: 1.42, w: 2.5, h: 0.45, fontSize: 22, bold: true, color: C.accent1, fontFace: THEME.headFontFace });
    T(s, c[1], { x: x + 0.2, y: 1.9, w: 2.5, h: 0.3, fontSize: 13, bold: true, color: C.text2 });
    T(s, c[2], { x: x + 0.2, y: 2.22, w: 2.5, h: 0.65, fontSize: 12, color: "374151" });
  });
  card(s, 0.5, 3.2, 5.6, 1.6, "E8EDF5");
  T(s, "Deny-overrides (Casbin 5.51.1)", { x: 0.7, y: 3.3, w: 5.2, h: 0.35, fontSize: 14, bold: true, color: C.text2 });
  T(s, "allowed = (∃ matching allow) ∧ ¬(∃ matching deny)", { x: 0.7, y: 3.72, w: 5.3, h: 0.45, fontSize: 18, color: C.text2, fontFace: "Cambria", italic: true });
  T(s, "A tenant's deny row beats even a baseline admin allow. Errors deny.", { x: 0.7, y: 4.22, w: 5.3, h: 0.45, fontSize: 12, color: "374151" });
  T(s, "59", { x: 6.5, y: 3.15, w: 3.0, h: 1.0, fontSize: 60, bold: true, color: C.accent1, fontFace: THEME.headFontFace });
  T(s, "policy scenarios tested (target: 40)", { x: 6.5, y: 4.2, w: 3.0, h: 0.5, fontSize: 13, color: "374151" });
}

// ================================================================ 9 Agents
{
  const s = content("Agents are principals, never fake users",
    "Agents are first-class principals, never fake users. AG01 is a reporting agent acting as itself: a client-credentials token, a registry entry and exactly one grant, list learning resources in Acme. It is audited as a service. AG02 acts for a user. It holds nothing of its own; the user creates a delegation bound to one tenant, a list of scopes and an expiry. Each request is evaluated as the user, with the user's current roles, intersected with the delegated scope and tenant. So if Alice loses a role, her agent loses it too, and if she revokes, the agent gets 401 on its very next call. Administrative scopes can never be delegated.");
  card(s, 0.5, 1.3, 4.35, 2.55, "EFEBF7");
  card(s, 5.15, 1.3, 4.35, 2.55, "E7F3F1");
  T(s, "AG01 · acts as itself", { x: 0.75, y: 1.42, w: 4.0, h: 0.4, fontSize: 17, bold: true, color: C.accent6 });
  T(s, [
    { text: "Client-credentials token, principal_kind=service", options: { bullet: true, breakLine: true } },
    { text: "Registry + exact grant: Acme, learning-resource:list", options: { bullet: true, breakLine: true } },
    { text: "No user, no membership, no Casbin roles", options: { bullet: true, breakLine: true } },
    { text: "Audited with actor_type = service", options: { bullet: true } },
  ], { x: 0.75, y: 1.9, w: 4.0, h: 1.9, fontSize: 13, paraSpaceAfter: 4 });
  T(s, "AG02 · acts for a user", { x: 5.4, y: 1.42, w: 4.0, h: 0.4, fontSize: 17, bold: true, color: C.accent1 });
  T(s, [
    { text: "User creates a delegation: tenant, scopes, expiry", options: { bullet: true, breakLine: true } },
    { text: "Request is evaluated AS the user, re-read every time", options: { bullet: true, breakLine: true } },
    { text: "Admin scopes are never delegable; no re-delegation", options: { bullet: true, breakLine: true } },
    { text: "Revoke, role loss, suspension: next request refused", options: { bullet: true } },
  ], { x: 5.4, y: 1.9, w: 4.0, h: 1.9, fontSize: 13, paraSpaceAfter: 4 });
  card(s, 0.5, 4.05, 9.0, 0.85, C.text2);
  T(s, "effective permission  =  user's current permission  ∩  delegated scope  ∩  tenant", { x: 0.7, y: 4.05, w: 8.6, h: 0.85, fontSize: 18, bold: true, color: C.background1, align: "center", valign: "middle" });
}

// ================================================================ 10 Implementation numbers
{
  const s = content("Implementation at a glance",
    "In numbers: a Node 24 and Fastify 5 backend with nine modules, 25 API routes, 18 tables from five migrations with composite foreign keys and triggers that make cross-tenant links impossible even if code is wrong, two Keycloak realms as JSON in the repository, and 253 tests in eleven files, 20 of them against the live provider.");
  const stats = [["9", "backend modules"], ["25", "API routes (/api/v1)"], ["18", "tables, 5 migrations"], ["253", "tests in 11 files"]];
  stats.forEach((st, i) => {
    const x = 0.5 + i * 2.3;
    T(s, st[0], { x, y: 1.3, w: 2.1, h: 0.9, fontSize: 48, bold: true, color: C.accent1, fontFace: THEME.headFontFace });
    T(s, st[1], { x, y: 2.2, w: 2.1, h: 0.4, fontSize: 13, color: "374151" });
  });
  card(s, 0.5, 2.9, 9.0, 1.95, C.background2);
  T(s, [
    { text: "Stack: ", options: { bold: true } }, { text: "Node 24 · Fastify 5.12 · Casbin 5.51 · jose 6.2 · Kysely · PostgreSQL 16.15 · Keycloak 26.8 · Docker Compose", options: { breakLine: true } },
    { text: "Database-enforced integrity: ", options: { bold: true } }, { text: "unique (issuer, subject); triggers reject cross-tenant role and teaching links; append-only consent; delegation FK → membership", options: { breakLine: true } },
    { text: "Clients: ", options: { bold: true } }, { text: "web and mobile-style pages; tokens only in memory; host configurable at runtime (IAM_PUBLIC_HOST)", options: { breakLine: true } },
    { text: "Tooling: ", options: { bold: true } }, { text: "non-destructive realm updater, browser proof, mutation runner, latency and baseline scripts, recorded demo" },
  ], { x: 0.7, y: 3.02, w: 8.6, h: 1.75, fontSize: 13, color: C.text1, paraSpaceAfter: 5 });
}

// ================================================================ 11 Results: baseline
sec("Results");
{
  const s = content("Baseline vs ours: is a revoked token still accepted?",
    "Our key experiment compares against the shortcut many APIs ship: JWT-only validation. We logged users out, ran admin logout-all, and disabled the agent, five times each, then presented the same token again. The baseline accepted the revoked token in all 15 trials, and kept accepting the agent's token for 59 of its 60 seconds; for user tokens that would be up to five minutes. Our API returned 401 on the very first request every time, within 7 to 22 milliseconds. The password-reset control shows an honest limit: Keycloak does not end sessions on reset, so neither approach revokes; incident response must call logout-all.");
  s.addChart(pres.charts.BAR, [
    { name: "Baseline: JWT-only", labels: ["Provider logout", "Admin logout-all", "Agent disabled", "Password reset (control)"], values: [5, 5, 5, 5] },
    { name: "Ours: + uncached introspection", labels: ["Provider logout", "Admin logout-all", "Agent disabled", "Password reset (control)"], values: [0, 0, 0, 5] },
  ], {
    x: 0.4, y: 1.15, w: 5.9, h: 3.85, barDir: "col", barGrouping: "clustered", barGapWidthPct: 60,
    chartColors: [HEX.accent2, HEX.accent1], showValue: true, dataLabelPosition: "outEnd",
    showTitle: true, title: "Trials where the revoked token was ACCEPTED on the first request (of 5)", titleFontSize: 12, titleColor: "1B1F24",
    showLegend: true, legendPos: "b", legendFontSize: 11, valAxisMaxVal: 6, valAxisMinVal: 0, valAxisMajorUnit: 1,
    ...quietAxes(), ...chartText,
  });
  card(s, 6.6, 1.25, 2.9, 1.7, "F9E8EB");
  T(s, "59.4 s", { x: 6.8, y: 1.32, w: 2.6, h: 0.75, fontSize: 40, bold: true, color: C.accent2, fontFace: THEME.headFontFace });
  T(s, "baseline kept accepting a disabled agent's token (median, 60 s life)", { x: 6.8, y: 2.1, w: 2.6, h: 0.8, fontSize: 12, color: "374151" });
  card(s, 6.6, 3.15, 2.9, 1.7, "E7F3F1");
  T(s, "0 s", { x: 6.8, y: 3.22, w: 2.6, h: 0.75, fontSize: 40, bold: true, color: C.accent1, fontFace: THEME.headFontFace });
  T(s, "ours: 401 on the first request in 15/15 trials (7–22 ms)", { x: 6.8, y: 4.0, w: 2.6, h: 0.8, fontSize: 12, color: "374151" });
}

// ================================================================ 12 Results: verification
{
  const s = content("Final clean-clone run: every test, every injected bug",
    "From a fresh clone of the final revision with new volumes: 253 of 253 tests pass against real PostgreSQL and live Keycloak, zero skipped. To prove the tests can fail, we break 15 security guards one at a time; all 15 are caught, and with the database stopped the runner reports inconclusive instead of success. The real-browser proof passes 11 of 11 on two host names. The growth also tells a story: the Week 3 head hid a real regression, which taught us to verify only from clean clones.");
  const revs = ["W2 0d232ec", "W4 start 953a0aa", "W4 42d8a43", "W5 fde2efd", "Final e13f019"];
  s.addChart(pres.charts.BAR, [{ name: "Tests passed", labels: revs, values: [159, 160, 197, 227, 253] }], {
    x: 0.4, y: 1.15, w: 4.6, h: 3.0, barDir: "col", chartColors: [HEX.accent4], showValue: true, dataLabelPosition: "outEnd",
    showTitle: true, title: "Tests passed (real DB + live Keycloak)", titleFontSize: 12, titleColor: "1B1F24", showLegend: false,
    valAxisMinVal: 0, valAxisMaxVal: 300, ...quietAxes(), catAxisLabelFontSize: 9, ...chartText,
  });
  s.addChart(pres.charts.BAR, [{ name: "Injected bugs caught", labels: revs, values: [0, 0, 7, 11, 15] }], {
    x: 5.1, y: 1.15, w: 4.5, h: 3.0, barDir: "col", chartColors: [HEX.accent1], showValue: true, dataLabelPosition: "outEnd",
    showTitle: true, title: "Injected security bugs caught (mutations)", titleFontSize: 12, titleColor: "1B1F24", showLegend: false,
    valAxisMinVal: 0, valAxisMaxVal: 18, ...quietAxes(), catAxisLabelFontSize: 9, ...chartText,
  });
  const st = [["253 / 0 / 0", "passed / failed / skipped"], ["15 / 15", "mutations killed; DB down → exit 2"], ["11 / 11", "browser checks, 2 hosts"], ["0", "npm audit vulnerabilities"]];
  st.forEach((x, i) => {
    T(s, x[0], { x: 0.5 + i * 2.3, y: 4.25, w: 2.2, h: 0.45, fontSize: 22, bold: true, color: C.accent1, fontFace: THEME.headFontFace });
    T(s, x[1], { x: 0.5 + i * 2.3, y: 4.7, w: 2.2, h: 0.4, fontSize: 11, color: "374151" });
  });
}

// ================================================================ 13 Cost
{
  const s = content("The price of correctness: about 3 ms per request",
    "Uncached introspection has a cost, so we measured it inside the container: three runs of 200 sequential requests. Local JWT verification, the baseline, takes 0.15 milliseconds. The introspection call alone is 3.3 milliseconds median, about a third of a full authenticated agent request at 9.3. We accept that price for revocation on the next request. These are single-machine observations, not a benchmark, and we did not optimise anything.");
  s.addChart(pres.charts.BAR, [
    { name: "p50", labels: ["Local JWT verify (baseline)", "GET /health (no auth)", "Introspection alone", "Full agent request (ours)"], values: [0.15, 0.65, 3.29, 9.25] },
    { name: "p95", labels: ["Local JWT verify (baseline)", "GET /health (no auth)", "Introspection alone", "Full agent request (ours)"], values: [0.28, 1.54, 5.58, 15.14] },
  ], {
    x: 0.4, y: 1.15, w: 6.0, h: 3.85, barDir: "col", barGrouping: "clustered", chartColors: [HEX.accent4, "9DB0CC"], showValue: true, dataLabelPosition: "outEnd",
    dataLabelFormatCode: "0.00", showTitle: true, title: "Latency in ms (median of 3 runs × 200 requests, in-container)", titleFontSize: 12, titleColor: "1B1F24",
    showLegend: true, legendPos: "b", legendFontSize: 11, valAxisMinVal: 0, valAxisMaxVal: 18, ...quietAxes(), catAxisLabelFontSize: 10, ...chartText,
  });
  card(s, 6.7, 1.3, 2.8, 3.6, C.background2);
  T(s, "≈ ⅓", { x: 6.9, y: 1.45, w: 2.4, h: 0.85, fontSize: 44, bold: true, color: C.accent4, fontFace: THEME.headFontFace });
  T(s, "of an authenticated request is the provider check (3.3 of 9.3 ms, p50)", { x: 6.9, y: 2.35, w: 2.4, h: 0.9, fontSize: 13, color: "374151" });
  T(s, "Observation on one machine, sequential; nothing was optimised and introspection was never disabled to gain speed.", { x: 6.9, y: 3.4, w: 2.4, h: 1.3, fontSize: 11, italic: true, color: "6B7280" });
}

// ================================================================ 14 Demo
{
  const s = content("Live demo: the end-to-end workflow",
    "Now the demo. If the live demo fails, the same flow is recorded in docs/demo/demo-walkthrough.mp4. Alice signs in through Keycloak with PKCE. In Acme, where she is admin, members is 200. In Globex, where she is a learner, members is 403. She delegates two scopes to the assistant agent: the agent gets 200 in scope, 403 on members and 403 in the other tenant, then 401 right after she revokes. Signing out makes her old token 401. Finally the enterprise user signs in through the broker and is refused admin actions.");
  const steps = [
    ["Sign in", "Alice → Keycloak (PKCE); app never sees the password"],
    ["Two tenants", "Acme members 200 (admin) · Globex members 403 (learner)"],
    ["Delegate", "POST /delegations: 2 scopes, Globex only, 15 min"],
    ["Agent calls", "in scope 200 · members 403 · other tenant 403"],
    ["Revoke", "agent's next request 401"],
    ["Sign out", "old, unexpired token → 401"],
    ["Enterprise SSO", "broker login; instructor: members 403"],
  ];
  steps.forEach((st, i) => {
    const y = 1.2 + i * 0.52;
    badge(s, 0.5, y, String(i + 1), C.accent1, 0.38);
    T(s, st[0], { x: 1.05, y, w: 1.6, h: 0.38, fontSize: 14, bold: true, color: C.text2, valign: "middle" });
    T(s, st[1], { x: 2.7, y, w: 3.6, h: 0.38, fontSize: 12, color: "374151", valign: "middle" });
  });
  card(s, 6.6, 1.2, 2.9, 3.6, C.text2);
  T(s, "Backup recording", { x: 6.8, y: 1.35, w: 2.5, h: 0.4, fontSize: 16, bold: true, color: C.accent3 });
  T(s, [
    { text: "docs/demo/demo-walkthrough.mp4", options: { breakLine: true, bold: true } },
    { text: "2 min 22 s, captioned, visible clicks, real calls", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "Regenerate:", options: { breakLine: true, bold: true } },
    { text: "node scripts/record-demo.mjs" },
  ], { x: 6.8, y: 1.85, w: 2.5, h: 2.8, fontSize: 12, color: C.background1 });
}

// ================================================================ 15 Limitations
sec("Conclusions");
{
  const s = content("Honest status: working, partial, missing",
    "We want to be precise about status. Working and verified: all milestones and both agents. Partial: M5 is the minimal provisioning slice, policy rows cannot be deleted through the API, agent grants are database-only, and AG02 uses a custom header instead of a standard token-exchange token. Missing: native mobile apps, a real corporate identity provider, production hardening, and the independent rerun on a second machine. Process: our evaluation protocol was frozen on 10 October, one day after the deadline, and we say so in the ADR log.");
  const cols = [
    ["WORKING", C.accent1, "E7F3F1", ["M1–M4, M6, M7 verified", "AG01 and AG02 verified", "Web, mobile-style, enterprise SSO", "Mutation runner + baseline experiment"]],
    ["PARTIAL", C.accent3, "FCF3E4", ["M5: minimal slice, no full SCIM", "Policy rows: add only, no delete", "AG01 grants only via seed / DB", "AG02 header, not RFC 8693 token"]],
    ["MISSING", C.accent2, "F9E8EB", ["Native Android / iOS apps", "Real corporate IdP, SAML", "TLS, managed secrets, rate limits", "Second-machine rerun, CI"]],
  ];
  cols.forEach((c, i) => {
    const x = 0.5 + i * 3.05;
    card(s, x, 1.3, 2.85, 3.0, c[2]);
    chip(s, x + 0.2, 1.45, 1.2, c[0], c[1]);
    T(s, c[3].map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < c[3].length - 1 } })), { x: x + 0.2, y: 1.9, w: 2.5, h: 2.3, fontSize: 13, paraSpaceAfter: 6 });
  });
  T(s, "Process debt we disclose: the evaluation protocol was frozen on 10 Oct, one day after the 9 Oct deadline (ADR-011).", { x: 0.5, y: 4.45, w: 9.0, h: 0.5, fontSize: 13, italic: true, color: C.accent4 });
}

// ================================================================ 16 Future work
{
  const s = content("Way forward: five next tasks",
    "Next steps, in priority order. First, independent reproduction on a second machine and in CI, using the one-command clean evaluation script. Second, audited administration APIs for agent grants, delegations and policy rows. Third, standard RFC 8693 token exchange for delegation, keeping our record as the revocation source. Fourth, full SCIM with DNS-verified domains. Fifth, production hardening. Each has a concrete done-when test in the report.");
  const tasks = [
    ["Independent reproduction + CI", "same 253/0/0, 15/15 and E1 verdicts on a second machine"],
    ["Audited agent & policy admin APIs", "grant/revoke, list delegations, delete policy rows"],
    ["RFC 8693 delegation tokens", "act claim accepted; revocation still 401 next request"],
    ["SCIM 2.0 + DNS-verified domains", "deprovisioned user's next request is 403"],
    ["Production hardening", "HTTPS, rotated secrets, immutable audit, 11/11 browser proof"],
  ];
  tasks.forEach((t, i) => {
    const y = 1.25 + i * 0.73;
    badge(s, 0.5, y + 0.05, String(i + 1), C.accent4, 0.44);
    card(s, 1.1, y, 8.4, 0.58, C.background2);
    T(s, t[0], { x: 1.3, y, w: 3.6, h: 0.58, fontSize: 14, bold: true, color: C.text2, valign: "middle" });
    T(s, "Done when: " + t[1], { x: 5.0, y, w: 4.4, h: 0.58, fontSize: 12, color: "374151", valign: "middle" });
  });
}

// ================================================================ 17 Takeaway
{
  const s = pres.addSlide({ masterName: "DARK", sectionTitle });
  T(s, "TAKEAWAY", { x: 0.6, y: 0.7, w: 8.8, h: 0.3, fontSize: 12, bold: true, color: C.accent3, charSpacing: 2 });
  T(s, "The hard part of identity is not login. It is deciding what a verified principal may do in this tenant, right now, and proving it.", { x: 0.6, y: 1.1, w: 8.8, h: 1.6, fontSize: 28, bold: true, color: C.background1, fontFace: THEME.headFontFace });
  const st = [["253/253", "tests, clean clone"], ["15/15", "injected bugs caught"], ["15/15", "revocations refused next request"], ["0 s", "exposure vs 59.4 s baseline"]];
  st.forEach((x, i) => {
    T(s, x[0], { x: 0.6 + i * 2.2, y: 3.05, w: 2.1, h: 0.6, fontSize: 26, bold: true, color: C.accent3, fontFace: THEME.headFontFace });
    T(s, x[1], { x: 0.6 + i * 2.2, y: 3.65, w: 2.0, h: 0.5, fontSize: 12, color: C.background2 });
  });
  T(s, "Thank you. Questions?  ·  github.com/krishnateja2314/iam-provider  ·  docs/Project_Report.pdf", { x: 0.6, y: 4.55, w: 8.8, h: 0.4, fontSize: 13, color: C.background1 });
  s.addNotes("To sum up: the hard part of identity is not login, which Keycloak does well. It is deciding what a verified principal, person or program, may do in this tenant right now, and proving it. Our final clean-clone run passes 253 of 253 tests, catches 15 of 15 injected bugs, and refuses every revoked credential on the next request where the JWT-only baseline kept accepting it. Thank you; we are happy to take questions.");
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
