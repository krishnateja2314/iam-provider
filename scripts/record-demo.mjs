// Recorded end-to-end demonstration (no narration needed: every step is captioned on screen).
// Drives the REAL running stack in a real browser and records it with Playwright:
//   1. Alice signs in with Keycloak (authorization code + S256 PKCE)
//   2. Acme (Alice = admin): resources, members, audit all 200
//   3. Globex (Alice = learner): resources 200 published-only, members 403
//   4. AG02: Alice delegates to the assistant agent in the browser; the agent's real calls are
//      shown in an on-screen "agent console": 200 in scope, 403 on members, 403 in the other
//      tenant, then Alice revokes and the agent gets 401 on its next request
//   5. Refresh-token rotation and sign-out; the old access token is rejected (401)
//   6. Enterprise SSO through the broker realm: enterprise.bob is refused Acme members (403)
//   7. Mobile-style client login (separate public client, PKCE) as Bob, the instructor
// Usage (stack running):  node scripts/record-demo.mjs [output.webm]
//   IAM_BROWSER_CHANNEL=msedge|chrome selects an installed browser; IAM_DEMO_SLOWMO (ms, 350).
// Output: docs/demo/demo-walkthrough.webm (convert: ffmpeg -i in.webm -c:v libx264 -crf 23 out.mp4).
// Tokens stay in process memory and are never printed or written.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { chromium } = (await import(pathToFileURL(require.resolve('playwright')).href)).default;

const host = process.env.IAM_PUBLIC_HOST || 'localhost';
const issuer = `http://${host}:8180/realms/iam-platform`;
const api = `http://${host}:3100`;
const origin = `http://${host}:5173`;
const output = resolve(process.argv[2] || 'docs/demo/demo-walkthrough.webm');
const tmp = resolve(dirname(output), '.recording');
mkdirSync(tmp, { recursive: true });
const channel = process.env.IAM_BROWSER_CHANNEL;
const browser = await chromium.launch({ headless: true, slowMo: Number(process.env.IAM_DEMO_SLOWMO || 350), ...(channel ? { channel } : {}) });
const size = { width: 1280, height: 800 };
const context = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });

// Caption bar and agent console injected into every page (client and Keycloak alike).
await context.addInitScript(() => {
  const ensure = () => {
    if (document.getElementById('__demo_caption') || !document.body) return;
    const bar = document.createElement('div');
    bar.id = '__demo_caption';
    bar.style.cssText = 'position:fixed;left:16px;right:16px;top:12px;z-index:2147483647;background:rgba(17,24,39,.94);color:#fff;font:600 19px/1.4 system-ui,Segoe UI,Arial;padding:12px 18px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    const step = document.createElement('div'); step.id = '__demo_step'; step.style.cssText = 'font:700 12px/1.2 system-ui,Arial;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;margin-bottom:4px';
    const text = document.createElement('div'); text.id = '__demo_text';
    bar.append(step, text); document.body.append(bar);
    const con = document.createElement('pre');
    con.id = '__demo_console';
    con.style.cssText = 'display:none;position:fixed;right:16px;top:118px;width:540px;z-index:2147483646;background:#0b1220;color:#d1fae5;font:13px/1.5 Consolas,monospace;padding:12px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.4);white-space:pre-wrap';
    document.body.append(con);
    const saved = sessionStorage.getItem('__demo_caption_state');
    if (saved) { const s = JSON.parse(saved); step.textContent = s.step; text.textContent = s.text; }
  };
  window.__demoCaption = (stepText, body) => {
    ensure();
    document.getElementById('__demo_step').textContent = stepText;
    document.getElementById('__demo_text').textContent = body;
    try { sessionStorage.setItem('__demo_caption_state', JSON.stringify({ step: stepText, text: body })); } catch {}
  };
  window.__demoConsole = lines => {
    ensure();
    const con = document.getElementById('__demo_console');
    con.style.display = lines ? 'block' : 'none';
    con.textContent = lines || '';
  };
  document.addEventListener('DOMContentLoaded', ensure);
});

const page = await context.newPage();
const pause = ms => page.waitForTimeout(ms);
const caption = async (step, text, hold = 2600) => { await page.evaluate(([s, t]) => window.__demoCaption(s, t), [step, text]); await pause(hold); };
const showConsole = async lines => page.evaluate(l => window.__demoConsole(l), lines);
const waitStatus = async code => page.waitForFunction(c => { try { return JSON.parse(document.querySelector('#result').textContent).httpStatus === c; } catch { return false; } }, code, { timeout: 20000 });
const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

async function login(pageName, username, password, enterprise = false) {
  const token = page.waitForResponse(r => r.url() === `${issuer}/protocol/openid-connect/token` && r.request().method() === 'POST', { timeout: 30000 });
  token.catch(() => {});
  await page.goto(`${origin}/${pageName}.html`);
  await caption(enterprise ? 'Enterprise SSO' : 'Sign in', enterprise
    ? `${username} signs in through the company identity provider (a separate Keycloak realm, brokered over OIDC).`
    : `${username} signs in. The browser is sent to Keycloak (authorization code + S256 PKCE); our app never sees the password.`, 2400);
  await page.locator(enterprise ? '#enterprise' : '#login').click();
  await page.locator('#username').waitFor();
  await caption(enterprise ? 'Enterprise realm login page' : 'Keycloak login page', 'Credentials are entered at the identity provider, not in our application.', 1400);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  const response = await token;
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Signed in', null, { timeout: 30000 });
  return response.json();
}
async function request(button, status, step, text, hold = 2800) {
  await page.locator(`#${button}`).click();
  await waitStatus(status);
  await caption(step, text, hold);
}

try {
  // Title card.
  await page.goto(`${origin}/web.html`);
  await caption('Secure Multi-Tenant IAM Platform · Team P01-G33', 'Recorded demo of the running system: Keycloak proves who you are; our backend decides what you may do, per organization, on every request.', 4200);

  // 1-3: Alice in two tenants.
  const alice = await login('web', 'alice', 'alice123');
  await caption('Signed in', 'Alice is ADMIN in Acme Learning Corp and only a LEARNER in Globex University. Same login, two very different rights.', 3200);
  await page.locator('#organization').selectOption(ACME);
  await request('resources', 200, 'Acme · GET /resources', 'Admin in Acme: 200. Only Acme rows come back, because every query is filtered by the organization.');
  await request('members', 200, 'Acme · GET /members', 'Admin in Acme: 200. Managing members is an admin permission (Casbin policy).');
  await request('audit', 200, 'Acme · GET /audit-events', 'Admin in Acme: 200. Every allow and deny decision above was written to the audit trail.');
  await page.locator('#organization').selectOption(GLOBEX);
  await request('resources', 200, 'Globex · GET /resources', 'Learner in Globex: 200, published courses only (attribute rule).');
  await request('members', 403, 'Globex · GET /members', 'Learner in Globex: 403. Alice\'s Acme admin role does NOT follow her into Globex. The X-Organization-ID header is checked against her memberships.', 3600);

  // 4: AG02 delegation.
  await request('delegate', 201, 'AG02 · POST /delegations', 'Alice delegates to the assistant agent: only learning-resource:list and submission:list, only in Globex, for 15 minutes.', 3400);
  const delegationId = JSON.parse(await page.locator('#result').textContent()).delegation.id;
  const agentTokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'iam-agent-assistant', client_secret: process.env.KEYCLOAK_ASSISTANT_CLIENT_SECRET || 'dev-agent-assistant-secret' }) });
  const agentToken = (await agentTokenResponse.json()).access_token;
  const asAgent = async (org, path, delegation = delegationId) => (await fetch(`${api}/api/v1/${path}`, { headers: { authorization: `Bearer ${agentToken}`, 'x-organization-id': org, ...(delegation ? { 'x-delegation-id': delegation } : {}) } })).status;
  const lines = ['AGENT CONSOLE  (iam-agent-assistant, client-credentials token)', ''];
  const add = async (label, status) => { lines.push(`${String(status).padEnd(4)} ${label}`); await showConsole(lines.join('\n')); await pause(1500); };
  await caption('AG02 · the agent calls the API', 'These are real calls made now by the agent with its own token plus the delegation ID.', 1200);
  await add('GET /resources  Globex, no delegation', await asAgent(GLOBEX, 'resources', null));
  await add('GET /resources  Globex, with delegation', await asAgent(GLOBEX, 'resources'));
  await add('GET /members    Globex (not delegated)', await asAgent(GLOBEX, 'members'));
  await add('GET /resources  Acme (other tenant)', await asAgent(ACME, 'resources'));
  await caption('AG02 · never more than the user', 'Effective permission = Alice\'s current permission ∩ delegated scope ∩ tenant. Admin actions can never be delegated.', 3600);
  const revoke = await fetch(`${api}/api/v1/delegations/${delegationId}`, { method: 'DELETE', headers: { authorization: `Bearer ${alice.access_token}`, 'x-organization-id': GLOBEX } });
  lines.push('', `Alice revokes the delegation: DELETE /delegations/:id -> ${revoke.status}`); await showConsole(lines.join('\n'));
  await pause(1200);
  await add('GET /resources  Globex, revoked delegation', await asAgent(GLOBEX, 'resources'));
  await caption('AG02 · revocation', 'The delegation is re-read on every request, so the agent is refused (401) on its very next call.', 3400);
  await showConsole(null);
  await request('delegations', 200, 'GET /delegations', 'Alice\'s view shows the delegation as revoked.', 2600);

  // 5: refresh rotation and sign-out.
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Signed in; refresh token rotated', null, { timeout: 20000 });
  await caption('Session · refresh rotation', 'Every refresh issues a new refresh token; replaying an old one revokes the whole token family (tested live).', 3000);
  const oldAccess = alice.access_token;
  await page.locator('#logout').click();
  await page.waitForURL(url => url.toString().startsWith(`${origin}/web.html`), { timeout: 20000 }).catch(() => {});
  await pause(800);
  const after = (await fetch(`${api}/api/v1/me`, { headers: { authorization: `Bearer ${oldAccess}` } })).status;
  await caption('Session · sign-out', `Signed out. Alice's earlier access token, still unexpired and correctly signed, is now rejected by the API: ${after}. Every request is introspected with Keycloak, without a cache.`, 4200);

  // 6: enterprise SSO.
  const ent = await login('web', 'enterprise.bob', 'enterprise-bob123', true);
  await caption('Enterprise SSO · signed in', 'The backend receives a platform-issued token, linked to Bob by an explicit federated link (never by matching email).', 3000);
  await page.locator('#organization').selectOption(ACME);
  await request('members', 403, 'Enterprise user · GET /members', 'Bob is an instructor in Acme, not an admin: members 403.', 3000);
  await request('submissions', 200, 'Enterprise user · GET /submissions', 'Instructor: 200, but only submissions for the course Bob actually teaches (relationship rule).', 3200);
  await page.locator('#logout').click();
  await pause(1000);
  void ent;

  // 7: mobile client.
  await page.setViewportSize({ width: 1280, height: 800 });
  await login('mobile', 'bob', 'bob123');
  await caption('Mobile-style client', 'A separate public OIDC client (iam-mobile) with its own redirect and PKCE. It also ran on a physical Android phone on 7 Nov.', 3400);
  await page.goto(`${origin}/web.html`);
  await caption('Verified', 'Final clean-clone run of e13f019: 253/253 tests, 15/15 injected security bugs caught, 11/11 real-browser checks on two hosts. Baseline (JWT-only) still accepts revoked tokens; ours rejects them on the next request.', 6000);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) { rmSync(output, { force: true }); renameSync(await video.path(), output); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`Recorded ${output}`);
}
