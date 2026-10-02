const issuer = 'http://localhost:8180/realms/iam-platform';
const clientId = document.body.dataset.client;
const redirectUri = `${location.origin}${location.pathname}`;
const transactionKey = `pkce:${clientId}`;
const status = document.querySelector('#status');
const profile = document.querySelector('#profile');
const organization = document.querySelector('#organization');
const result = document.querySelector('#result');
let tokens;
let busy = false;
let sessionNonce;
let sessionSubject;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));

function controls() {
  for (const id of ['login', 'enterprise']) document.getElementById(id).disabled = busy;
  for (const id of ['refresh', 'logout']) document.getElementById(id).disabled = busy || !tokens;
  organization.disabled = busy || !tokens || !organization.value;
  for (const id of ['resources', 'members', 'submissions', 'audit']) document.getElementById(id).disabled = busy || !tokens || !organization.value;
  document.getElementById('sessions').disabled = busy || !tokens;
}
async function tokenRequest(params) {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  if (!response.ok) throw new Error(`Token exchange rejected (${response.status})`);
  return response.json();
}

// Validate the ID token independently; never treat decoded unsigned claims as identity.
async function validateIdToken(jwt, nonce, refreshing = false) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token');
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported signing key');
  const response = await fetch(`${issuer}/protocol/openid-connect/certs`);
  if (!response.ok) throw new Error('Signing keys unavailable');
  const { keys } = await response.json();
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
  if (!jwk) throw new Error('Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!verified || claims.iss !== issuer || !audiences.every(value => typeof value === 'string') || !audiences.includes(clientId) ||
      ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
      !Number.isFinite(claims.iat) || claims.iat > Date.now() / 1000 + 30 ||
      ((!refreshing || claims.nonce !== undefined) && claims.nonce !== nonce) || typeof claims.sub !== 'string' || !claims.sub ||
      (refreshing && claims.sub !== sessionSubject) ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > Date.now() / 1000 + 30))) throw new Error('ID token validation failed');
  return claims;
}

async function login(enterprise) {
  const verifier = random();
  const state = random();
  const nonce = random();
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // Only the short-lived login transaction crosses the redirect. No tokens are persisted.
  sessionStorage.setItem(transactionKey, JSON.stringify({ verifier, state, nonce, created: Date.now() }));
  const url = new URL(`${issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: 'code', scope: 'openid profile email', state, nonce,
    code_challenge: challenge, code_challenge_method: 'S256', ...(enterprise ? { kc_idp_hint: 'enterprise' } : {}) });
  location.assign(url);
}

async function showProfile() {
  const response = await fetch('http://localhost:3100/api/v1/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!response.ok) throw new Error(`API rejected session (${response.status})`);
  const data = await response.json();
  profile.textContent = JSON.stringify(data, null, 2);
  const selected = organization.value;
  organization.replaceChildren();
  for (const tenant of data.organizations || []) {
    const option = document.createElement('option');
    option.value = tenant.organizationId;
    option.textContent = `${tenant.organizationName} (${tenant.roles.join(', ')})`;
    organization.append(option);
  }
  if ([...organization.options].some(option => option.value === selected)) organization.value = selected;
  if (!organization.options.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'No active tenant memberships'; organization.append(option);
  }
  status.textContent = 'Signed in';
}

async function callback() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return;
  history.replaceState({}, '', redirectUri);
  const saved = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (!saved) throw new Error('Missing login transaction');
  const transaction = JSON.parse(saved);
  if (typeof transaction.created !== 'number' || transaction.created > Date.now() ||
      params.get('state') !== transaction.state || Date.now() - transaction.created > 300000 ||
      (params.has('iss') && params.get('iss') !== issuer)) throw new Error('Invalid or expired login transaction');
  if (params.has('error')) throw new Error('Identity provider declined login');
  const next = await tokenRequest({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri, code_verifier: transaction.verifier });
  if (next.token_type?.toLowerCase() !== 'bearer') throw new Error('Unsupported token type');
  const identity = await validateIdToken(next.id_token, transaction.nonce);
  sessionNonce = transaction.nonce;
  sessionSubject = identity.sub;
  tokens = next;
  await showProfile();
}

async function run(action) {
  if (busy) return;
  busy = true; controls();
  try { await action(); }
  catch (error) { tokens = undefined; profile.textContent = ''; organization.replaceChildren(); result.textContent = ''; status.textContent = error.message; }
  finally { busy = false; controls(); }
}
document.getElementById('login').onclick = () => run(() => login(false));
document.getElementById('enterprise').onclick = () => run(() => login(true));
organization.onchange = () => { result.textContent = 'Tenant changed; request resources to re-evaluate current permissions.'; controls(); };
for (const [id, path, tenantRequired] of [
  ['resources', 'resources', true], ['members', 'members', true], ['submissions', 'submissions', true],
  ['audit', 'audit-events?limit=20', true], ['sessions', 'sessions', false],
]) document.getElementById(id).onclick = () => run(async () => {
  const response = await fetch(`http://localhost:3100/api/v1/${path}`, { headers: {
    Authorization: `Bearer ${tokens.access_token}`, ...(tenantRequired ? { 'X-Organization-ID': organization.value } : {}),
  } });
  const data = await response.json();
  // A denied tenant operation is expected demo evidence, not a reason to discard login.
  result.textContent = JSON.stringify({ httpStatus: response.status, ...data }, null, 2);
  status.textContent = response.ok ? 'Signed in; request allowed' : `Signed in; request denied (${response.status})`;
});
document.getElementById('refresh').onclick = () => run(async () => {
  const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  if (next.token_type?.toLowerCase() !== 'bearer') throw new Error('Unsupported token type');
  // OIDC refresh responses may omit nonce; a present nonce must still match,
  // and the verified issuer/audience/subject must remain the original identity.
  await validateIdToken(next.id_token, sessionNonce, true);
  tokens = next;
  await showProfile();
  status.textContent = 'Signed in; refresh token rotated';
});
document.getElementById('logout').onclick = () => run(async () => {
  const idToken = tokens.id_token;
  tokens = undefined; profile.textContent = '';
  // POST keeps the ID-token hint out of browser URLs/history and server URL logs.
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${issuer}/protocol/openid-connect/logout`;
  for (const [name, value] of Object.entries({ client_id: clientId, id_token_hint: idToken, post_logout_redirect_uri: redirectUri })) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
  }
  document.body.append(form);
  form.submit();
});
run(callback);
