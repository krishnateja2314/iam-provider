// Real browser login evidence. Tokens live only in process memory; no traces/HARs.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { chromium } = (await import(pathToFileURL(require.resolve('playwright')).href)).default;
const { createRemoteJWKSet, jwtVerify } = await import(pathToFileURL(require.resolve('jose')).href);
const issuer = 'http://localhost:8180/realms/iam-platform';
const apiBase = 'http://localhost:3100';
const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
function check(condition, label) { if (!condition) throw new Error(label); }
const channel = process.env.IAM_BROWSER_CHANNEL;
if (channel && !['chrome', 'msedge'].includes(channel)) throw new Error('IAM_BROWSER_CHANNEL must be chrome or msedge');
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const sessions = [];
let providerToken;
let negativeTestUser;

async function form(path, values) {
  return fetch(`${issuer}/protocol/openid-connect/${path}`, { method: 'POST', body: new URLSearchParams(values), signal: AbortSignal.timeout(15000), redirect: 'error' });
}
async function provider(path, method = 'GET', body) {
  return fetch(`http://localhost:8180/admin/realms/iam-platform${path}`, { method, signal: AbortSignal.timeout(15000), redirect: 'error',
    headers: { Authorization: `Bearer ${providerToken}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function authenticate(pageName, username, password, enterprise = false, wrongVerifier = false) {
  const context = await browser.newContext({ viewport: pageName === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
  const page = await context.newPage();
  let captured;
  let challengeSeen = false;
  let brokerSeen = false;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/realms/iam-platform/protocol/openid-connect/auth') {
      challengeSeen = url.searchParams.get('code_challenge_method') === 'S256' && url.searchParams.get('code_challenge')?.length === 43;
    }
    if (url.pathname === '/realms/iam-enterprise/protocol/openid-connect/auth') brokerSeen = true;
  });
  if (wrongVerifier) {
    await page.route(`${issuer}/protocol/openid-connect/token`, async route => {
      const params = new URLSearchParams(route.request().postData());
      params.set('code_verifier', 'incorrect-verifier-that-is-at-least-forty-three-characters');
      await route.continue({ postData: params.toString() });
    });
  }
  const tokenResponse = page.waitForResponse(response => response.url() === `${issuer}/protocol/openid-connect/token` && response.request().method() === 'POST', { timeout: 30000 });
  // Avoid an unhandled timeout if navigation itself fails.
  tokenResponse.catch(() => {});
  await page.goto(`http://localhost:5173/${pageName}.html`);
  await page.locator(enterprise ? '#enterprise' : '#login').click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  const response = await tokenResponse;
  if (wrongVerifier) {
    check(response.status() === 400, 'Wrong PKCE verifier must be rejected');
    await context.close();
    console.log('PASS: wrong PKCE verifier rejected by provider');
    return;
  }
  check(response.ok(), `${pageName} authorization code exchange failed`);
  captured = await response.json();
  const { payload } = await jwtVerify(captured.access_token, jwks, { issuer, audience: 'iam-backend', algorithms: ['RS256'] });
  check(challengeSeen && (!enterprise || brokerSeen), 'PKCE/broker redirect evidence missing');
  check(payload.typ === 'Bearer', 'Access token Bearer claim missing');
  check(payload.sub === `70000000-0000-0000-0000-00000000000${username === 'alice' ? '1' : '2'}`, 'Fixed seed issuer/subject mapping changed');
  const roles = payload.realm_access?.roles || [];
  check(roles.includes('platform-admin') === (username === 'alice'), 'Platform role boundary violated');
  check(typeof payload.sid === 'string' || typeof payload.session_state === 'string', 'Provider session reference missing');
  const session = { ...captured, sid: payload.sid || payload.session_state, clientId: `iam-${pageName}`, context, page };
  sessions.push(session);
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Signed in');
  check(!(await page.content()).includes(captured.access_token), 'Client displayed raw access token');
  const persisted = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]);
  check(!persisted.some(value => value.includes(captured.access_token) || value.includes(captured.refresh_token)), 'Client persisted tokens');
  console.log(`PASS: ${pageName} ${enterprise ? 'enterprise OIDC broker' : 'local'} login, S256 PKCE, signed audience/type/role/subject checks`);
  return session;
}
async function me(token) {
  return fetch(`${apiBase}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
}
async function tenant(token, organizationId, path) {
  return fetch(`${apiBase}/api/v1/${path}`, { headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': organizationId } });
}

try {
  const admin = await form('token', { grant_type: 'client_credentials', client_id: 'iam-provider-admin', client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || 'dev-provider-admin-secret' });
  check(admin.ok, `Provider service-account authentication failed (${admin.status})`);
  providerToken = (await admin.json()).access_token;
  const forbidden = await provider('', 'PUT', { realm: 'iam-platform' });
  check(forbidden.status === 403, 'Provider service account can mutate realm configuration');
  console.log('PASS: bounded provider service account cannot administer realm settings');
  const negativeUsername = `pkce-negative-${randomUUID()}`;
  const negativePassword = `Synthetic-${randomUUID()}`;
  const created = await provider('/users', 'POST', { username: negativeUsername, enabled: true,
    email: `${negativeUsername}@example.invalid`, emailVerified: true, firstName: 'PKCE', lastName: 'Negative',
    credentials: [{ type: 'password', value: negativePassword, temporary: false }],
  });
  check(created.status === 201, 'Isolated negative PKCE test user creation failed');
  negativeTestUser = created.headers.get('location')?.split('/').pop();
  check(negativeTestUser && /^[0-9a-f-]{36}$/.test(negativeTestUser), 'Negative test user reference missing');
  await authenticate('web', negativeUsername, negativePassword, false, true);
  check((await provider(`/users/${negativeTestUser}`, 'DELETE')).status === 204, 'Isolated negative PKCE test user cleanup failed');
  negativeTestUser = undefined;
  const web = await authenticate('web', 'alice', 'alice123');
  const identity = await (await me(web.access_token)).json();
  const adminOrg = identity.organizations.find(item => item.roles.includes('admin'));
  const learnerOrg = identity.organizations.find(item => item.roles.includes('learner') && !item.roles.includes('admin'));
  check(adminOrg && learnerOrg, 'Alice multi-tenant role fixtures missing');
  await web.page.locator('#organization').selectOption(adminOrg.organizationId);
  await web.page.locator('#resources').click();
  await web.page.waitForFunction(() => { try { return JSON.parse(document.querySelector('#result').textContent).httpStatus === 200; } catch { return false; } });
  const adminResources = JSON.parse(await web.page.locator('#result').textContent());
  check(adminResources.organizationId === adminOrg.organizationId && adminResources.resources.every(item => item.organization_id === adminOrg.organizationId), 'Admin resource list escaped tenant');
  await web.page.locator('#organization').selectOption(learnerOrg.organizationId);
  await web.page.locator('#resources').click();
  await web.page.waitForFunction(() => { try { return JSON.parse(document.querySelector('#result').textContent).httpStatus === 200; } catch { return false; } });
  const learnerResources = JSON.parse(await web.page.locator('#result').textContent());
  check(learnerResources.organizationId === learnerOrg.organizationId && learnerResources.resources.every(item => item.organization_id === learnerOrg.organizationId && item.status === 'published'), 'Learner list leaked another tenant or unpublished resource');
  await web.page.locator('#members').click();
  await web.page.waitForFunction(() => { try { return JSON.parse(document.querySelector('#result').textContent).httpStatus === 403; } catch { return false; } });
  check((await tenant(web.access_token, adminOrg.organizationId, 'members')).ok, 'Tenant-admin member access denied');
  check(learnerResources.resources.length > 0, 'Published cross-tenant resource fixture missing');
  const crossTenant = await tenant(web.access_token, adminOrg.organizationId, `resources/${learnerResources.resources[0].id}`);
  check(crossTenant.status === 404, 'Cross-tenant resource ID did not return404');
  const denyAudit = await tenant(web.access_token, adminOrg.organizationId, 'audit-events?decision=deny&limit=20');
  check(denyAudit.ok && (await denyAudit.json()).events.length > 0, 'Tenant-admin deny audit evidence missing');
  const allowAudit = await tenant(web.access_token, adminOrg.organizationId, 'audit-events?decision=allow&limit=20');
  check(allowAudit.ok && (await allowAudit.json()).events.length > 0, 'Tenant-admin allow audit evidence missing');
  check((await tenant(web.access_token, learnerOrg.organizationId, 'audit-events')).status === 403, 'Learner tenant audit access allowed');
  console.log('PASS: browser tenant selector, same-user admin/learner boundary, published lists, member403, cross-tenant404 and tenant-scoped allow/deny audit');
  const mobile = await authenticate('mobile', 'bob', 'bob123');
  const enterprise = await authenticate('web', 'enterprise.bob', 'enterprise-bob123', true);
  const enterpriseMobile = await authenticate('mobile', 'enterprise.bob', 'enterprise-bob123', true);
  const ownResponse = await fetch(`${apiBase}/api/v1/sessions`, { headers: { Authorization: `Bearer ${enterprise.access_token}` } });
  check(ownResponse.ok, 'Own-session listing failed');
  const { sessions: ownSessions } = await ownResponse.json();
  check(Array.isArray(ownSessions) && ownSessions.some(item => item.id === mobile.sid) &&
    ownSessions.some(item => item.id === enterprise.sid) && !ownSessions.some(item => item.id === web.sid), 'Session list ownership boundary violated');
  const foreign = await fetch(`${apiBase}/api/v1/sessions/${encodeURIComponent(web.sid)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${enterprise.access_token}` } });
  check(foreign.status === 404 || foreign.status === 403, 'Real foreign user session operation not denied');
  check((await me(web.access_token)).ok, 'Foreign-session denial changed the victim session');
  console.log('PASS: own-session listing excludes another user; deleting that real foreign session is denied');
  const refreshResponse = web.page.waitForResponse(response => response.url() === `${issuer}/protocol/openid-connect/token` &&
    new URLSearchParams(response.request().postData()).get('grant_type') === 'refresh_token');
  await web.page.locator('#refresh').click();
  const refresh = await refreshResponse;
  check(refresh.ok(), 'First refresh failed');
  const rotated = await refresh.json();
  await web.page.waitForFunction(() => document.querySelector('#status').textContent === 'Signed in; refresh token rotated');
  await jwtVerify(rotated.access_token, jwks, { issuer, audience: 'iam-backend', algorithms: ['RS256'] });
  check(rotated.refresh_token !== web.refresh_token, 'Refresh token was not rotated');
  const replay = await form('token', { grant_type: 'refresh_token', client_id: web.clientId, refresh_token: web.refresh_token });
  check(replay.status === 400, 'Old refresh token replay was accepted');
  console.log('PASS: refresh rotation and old refresh token reuse rejection');
  check((await me(mobile.access_token)).ok, 'Mobile session is not active');
  check((await me(enterprise.access_token)).ok, 'Broker session is not active');
  const revoke = await fetch(`${apiBase}/api/v1/sessions/${encodeURIComponent(mobile.sid)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${enterprise.access_token}` } });
  check(revoke.ok && (await revoke.json()).revoked === true, 'Own-session API revocation failed');
  check((await me(mobile.access_token)).status === 401, 'Revoked access token still accepted by API');
  const rejectedRefresh = await form('token', { grant_type: 'refresh_token', client_id: mobile.clientId, refresh_token: mobile.refresh_token });
  check(rejectedRefresh.status === 400, 'Revoked refresh token still accepted');
  check((await me(enterprise.access_token)).ok, 'Revoking one session revoked another device');
  check((await me(enterpriseMobile.access_token)).ok, 'Revoking local session revoked enterprise mobile device');
  console.log('PASS: individual session revoke immediately rejects existing access/refresh tokens; other device remains active');
  console.log('PKCE browser verification complete. No tokens, traces or browser storage were exported.');
} catch (error) {
  // Playwright errors may contain callback URLs; deliberately print neither stack nor URLs.
  console.error(`Browser verification failed: ${error.message.split('\n')[0].replace(/https?:\/\/\S+/g, '[redacted URL]')}`);
  process.exitCode = 1;
} finally {
  if (negativeTestUser && providerToken) {
    const deleted = await provider(`/users/${negativeTestUser}`, 'DELETE').catch(() => undefined);
    if (deleted?.status !== 204 && deleted?.status !== 404) {
      console.error('Isolated PKCE test user cleanup failed'); process.exitCode = 1;
    }
  }
  for (const session of sessions) {
    if (providerToken) {
      const deleted = await provider(`/sessions/${encodeURIComponent(session.sid)}`, 'DELETE').catch(() => undefined);
      if (deleted?.status !== 204 && deleted?.status !== 404) {
        console.error('Created platform session cleanup failed'); process.exitCode = 1;
      }
    }
    await session.context.close().catch(() => {});
  }
  await browser.close();
}
