// Baseline-versus-solution experiment E1: is a revoked session still accepted?
//
// Baseline B0 ("JWT-only"): the common shortcut of accepting any access token whose RS256
// signature, issuer, audience, expiry and typ=Bearer verify against the provider's JWKS. No
// introspection. This is exactly the first half of our validator (token-validator.ts) and what
// many APIs ship.
// Solution S1: the running API (GET /api/v1/me), which also performs uncached introspection.
//
// For every trial a fresh, uniquely named synthetic user is created, logged in, and then one
// revocation operation is applied:
//   provider-logout   POST .../protocol/openid-connect/logout with the refresh token
//   admin-logout-all  POST /admin/realms/iam-platform/users/{id}/logout
//   password-reset    PUT  /admin/.../users/{id}/reset-password (control: NOT a revocation)
//   agent-client-disabled  AG01 client disabled at the provider (real 60 s agent tokens)
// Note: iam-test caps its sessions at 3 s (it exists for expiry tests), so human-token windows are
// bounded by that; the agent scenario shows the window for a normal, uncapped token lifetime.
// Then the same access token is presented to B0 and S1 every POLL_MS until it expires.
// We record the first-request result and how long each verifier keeps accepting it.
//
// Runs INSIDE the backend container (private network, jose and pg available):
//   $env:IAM_ALLOW_PASSWORD_GRANT_TESTS = "true"; node scripts/configure-keycloak.mjs --enable-test-client
//   Get-Content evaluation/scripts/baseline-revocation.mjs | docker compose exec -T backend node --input-type=module -
//   node scripts/configure-keycloak.mjs; Remove-Item Env:IAM_ALLOW_PASSWORD_GRANT_TESTS
// Options (env): IAM_EVAL_TRIALS (5 per human operation), IAM_EVAL_AGENT_TRIALS (5, sequential,
// about 62 s each), IAM_EVAL_POLL_MS (1000).
// Prints JSON lines only; never prints or stores a token or password.
import * as jose from 'jose';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const trials = Number(process.env.IAM_EVAL_TRIALS || 5);
const pollMs = Number(process.env.IAM_EVAL_POLL_MS || 1000);
const issuer = process.env.JWT_ISSUER || 'http://localhost:8180/realms/iam-platform';
const internal = (process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak:8080').replace(/\/$/, '');
const realm = `${internal}/realms/iam-platform`;
const adminBase = `${internal}/admin/realms/iam-platform`;
const api = `http://127.0.0.1:${process.env.PORT || '3100'}`;
const testClient = { client_id: 'iam-test', client_secret: process.env.KEYCLOAK_TEST_CLIENT_SECRET || 'dev-test-client-secret' };
const adminClient = { client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'iam-provider-admin', client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || 'dev-provider-admin-secret' };
const jwks = jose.createRemoteJWKSet(new URL(process.env.JWKS_URL || `${realm}/protocol/openid-connect/certs`));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const form = fields => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

async function baselineAccepts(token) {
  try {
    const { payload } = await jose.jwtVerify(token, jwks, { issuer, audience: 'iam-backend', algorithms: ['RS256'], requiredClaims: ['exp', 'sub', 'iss', 'aud'] });
    return payload.typ === 'Bearer';
  } catch { return false; }
}
async function solutionStatus(token) {
  return (await fetch(`${api}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } })).status;
}

let adminToken;
async function admin(path, method = 'GET', body) {
  const response = await fetch(`${adminBase}${path}`, { method, headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`admin ${method} ${path.split('/')[1]} failed: ${response.status}`);
  return response;
}

const created = [];
async function newSession() {
  const username = `eval-${randomUUID()}`;
  const password = `${randomUUID()}Aa1!`;
  const response = await admin('/users', 'POST', { username, enabled: true, emailVerified: true, firstName: 'Eval', lastName: 'User', email: `${username}@example.invalid`, credentials: [{ type: 'password', value: password, temporary: false }] });
  const id = response.headers.get('location').split('/').pop();
  created.push(id);
  const login = await fetch(`${realm}/protocol/openid-connect/token`, form({ ...testClient, grant_type: 'password', username, password, scope: 'openid' }));
  if (!login.ok) throw new Error(`login failed: ${login.status} (is iam-test enabled?)`);
  const tokens = await login.json();
  return { id, access: tokens.access_token, refresh: tokens.refresh_token, exp: jose.decodeJwt(tokens.access_token).exp };
}

const operations = {
  'provider-logout': async s => { const r = await fetch(`${realm}/protocol/openid-connect/logout`, form({ ...testClient, refresh_token: s.refresh })); if (!r.ok) throw new Error(`logout ${r.status}`); },
  'admin-logout-all': async s => { await admin(`/users/${s.id}/logout`, 'POST'); },
  'password-reset': async s => { await admin(`/users/${s.id}/reset-password`, 'PUT', { type: 'password', value: `${randomUUID()}Bb2!`, temporary: false }); },
};

async function trial(operation, n) {
  const s = await newSession();
  const before = { baseline: await baselineAccepts(s.access), solution: await solutionStatus(s.access) };
  await operations[operation](s);
  const t0 = performance.now();
  const first = { solution: await solutionStatus(s.access), solutionMs: Math.round(performance.now() - t0), baseline: await baselineAccepts(s.access) };
  let baselineLastAcceptMs = first.baseline ? 0 : null; let solutionLastAcceptMs = first.solution === 200 ? 0 : null;
  let polls = 0; let baselineAccepted = first.baseline ? 1 : 0; let solutionAccepted = first.solution === 200 ? 1 : 0;
  while (Date.now() / 1000 < s.exp + 2) {
    await sleep(pollMs); polls++;
    const at = Math.round(performance.now() - t0);
    if (await baselineAccepts(s.access)) { baselineAccepted++; baselineLastAcceptMs = at; }
    if ((await solutionStatus(s.access)) === 200) { solutionAccepted++; solutionLastAcceptMs = at; }
  }
  const row = { experiment: 'E1', operation, trial: n, before, first, polls: polls + 1, baselineAccepted, solutionAccepted,
    baselineWindowS: baselineLastAcceptMs === null ? 0 : Math.round(baselineLastAcceptMs / 100) / 10,
    solutionWindowS: solutionLastAcceptMs === null ? 0 : Math.round(solutionLastAcceptMs / 100) / 10 };
  console.log(JSON.stringify(row));
  return row;
}

// Agent scenario: real 60 s AG01 client-credentials tokens, revoked by disabling the client at the
// provider. Uses the local bootstrap admin (iam-provider-admin deliberately cannot manage clients),
// runs trials one after another and always restores the client.
const agentSecret = process.env.KEYCLOAK_AGENT_CLIENT_SECRET || 'dev-agent-reporting-secret';
const ACME = '10000000-0000-0000-0000-000000000001';
async function bootstrapAdmin() {
  const r = await fetch(`${internal}/realms/master/protocol/openid-connect/token`, form({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KEYCLOAK_ADMIN || 'admin', password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin_dev_password' }));
  if (!r.ok) throw new Error(`bootstrap admin ${r.status}`);
  return (await r.json()).access_token;
}
async function agentTrials(count) {
  const out = [];
  for (let n = 1; n <= count; n++) {
    let token = await bootstrapAdmin();
    const call = (path, method = 'GET', body) => fetch(`${adminBase}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const [client] = await (await call('/clients?clientId=iam-agent-reporting')).json();
    const issued = await fetch(`${realm}/protocol/openid-connect/token`, form({ grant_type: 'client_credentials', client_id: 'iam-agent-reporting', client_secret: agentSecret }));
    const access = (await issued.json()).access_token;
    const exp = jose.decodeJwt(access).exp;
    const status = async () => (await fetch(`${api}/api/v1/resources`, { headers: { authorization: `Bearer ${access}`, 'x-organization-id': ACME } })).status;
    const before = { baseline: await baselineAccepts(access), solution: await status() };
    let row;
    const disabled = await call(`/clients/${client.id}`, 'PUT', { ...client, enabled: false });
    if (!disabled.ok) throw new Error(`disable ${disabled.status}`);
    try {
      const t0 = performance.now();
      const first = { solution: await status(), solutionMs: Math.round(performance.now() - t0), baseline: await baselineAccepts(access) };
      let bLast = first.baseline ? 0 : null; let sLast = first.solution === 200 ? 0 : null; let b = first.baseline ? 1 : 0; let s = first.solution === 200 ? 1 : 0; let polls = 1;
      while (Date.now() / 1000 < exp + 2) {
        await sleep(pollMs); polls++;
        const at = Math.round(performance.now() - t0);
        if (await baselineAccepts(access)) { b++; bLast = at; }
        if ((await status()) === 200) { s++; sLast = at; }
      }
      row = { experiment: 'E1', operation: 'agent-client-disabled', trial: n, tokenLifetimeS: exp - jose.decodeJwt(access).iat, before, first, polls, baselineAccepted: b, solutionAccepted: s,
        baselineWindowS: bLast === null ? 0 : Math.round(bLast / 100) / 10, solutionWindowS: sLast === null ? 0 : Math.round(sLast / 100) / 10 };
    } finally {
      token = await bootstrapAdmin();
      await call(`/clients/${client.id}`, 'PUT', client);
    }
    console.log(JSON.stringify(row));
    out.push(row);
  }
  return out;
}

async function verifierCost(samples = 500) {
  const s = await newSession();
  await baselineAccepts(s.access); // JWKS fetched and cached
  const times = [];
  for (let i = 0; i < samples; i++) { const t = performance.now(); await baselineAccepts(s.access); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  const pick = p => Math.round(times[Math.min(times.length - 1, Math.ceil(p / 100 * times.length) - 1)] * 1000) / 1000;
  const row = { experiment: 'E1-cost', series: 'baseline-local-jwt-verify', samples, p50: pick(50), p95: pick(95), p99: pick(99) };
  console.log(JSON.stringify(row));
}

console.log(JSON.stringify({ experiment: 'E1', started: new Date().toISOString(), trialsPerOperation: trials, pollMs, issuer }));
const adminResponse = await fetch(`${realm}/protocol/openid-connect/token`, form({ ...adminClient, grant_type: 'client_credentials' }));
if (!adminResponse.ok) { console.log(JSON.stringify({ error: `provider admin auth ${adminResponse.status}` })); process.exit(2); }
adminToken = (await adminResponse.json()).access_token;
let rows = [];
try {
  await verifierCost();
  const jobs = [];
  for (const operation of Object.keys(operations)) for (let n = 1; n <= trials; n++) jobs.push(trial(operation, n));
  jobs.push(agentTrials(Number(process.env.IAM_EVAL_AGENT_TRIALS || 5)));
  rows = (await Promise.all(jobs)).flat();
} finally {
  // Remove the synthetic provider users and the app rows their /me calls created (just-in-time).
  for (const id of created) await admin(`/users/${id}`, 'DELETE').catch(() => {});
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query('DELETE FROM users WHERE id IN (SELECT user_id FROM authentication_identities WHERE issuer = $1 AND subject = ANY($2))', [issuer, created]);
  await db.end();
}
const summary = {};
for (const op of [...Object.keys(operations), 'agent-client-disabled']) {
  const r = rows.filter(row => row.operation === op);
  const med = values => { const v = [...values].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  summary[op] = { trials: r.length,
    allValidBefore: r.every(x => x.before.baseline && x.before.solution === 200),
    baselineFirstAccept: r.filter(x => x.first.baseline).length, solutionFirst401: r.filter(x => x.first.solution === 401).length,
    solutionFirst200: r.filter(x => x.first.solution === 200).length,
    baselineWindowMedianS: med(r.map(x => x.baselineWindowS)), solutionWindowMedianS: med(r.map(x => x.solutionWindowS)),
    solutionFirstMsMedian: med(r.map(x => x.first.solutionMs)) };
}
console.log(JSON.stringify({ experiment: 'E1', summary, finished: new Date().toISOString() }));
const revocations = ['provider-logout', 'admin-logout-all', 'agent-client-disabled'];
const ok = revocations.every(op => summary[op].allValidBefore && summary[op].solutionFirst401 === summary[op].trials);
process.exitCode = ok ? 0 : 1;
