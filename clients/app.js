const issuer = 'http://localhost:8180/realms/iam-platform';
const clientId = document.body.dataset.client;
const redirectUri = `${location.origin}${location.pathname}`;
const transactionKey = `pkce:${clientId}`;
const status = document.querySelector('#status');
const profile = document.querySelector('#profile');
const organization = document.querySelector('#organization');
const result = document.querySelector('#result');
const identityView = document.querySelector('#identity');
const verdict = document.querySelector('#verdict');
const view = document.querySelector('#view');
const log = document.querySelector('#log');
let tokens;
let busy = false;
let sessionNonce;
let sessionSubject;
let orgNames = new Map();
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));

// Rendering helpers. API data is only ever assigned through textContent, never parsed as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter(child => child !== undefined && child !== null));
  return node;
}
const shortId = value => (typeof value === 'string' && value.length > 12 ? `${value.slice(0, 8)}…` : value ?? '');
const clock = value => {
  const date = value === undefined ? new Date() : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour12: false });
};
function setStatus(text, state) { status.textContent = text; status.dataset.state = state; }
function setVerdict(outcome, code, label, line) {
  verdict.dataset.outcome = outcome;
  document.querySelector('#verdict-code').textContent = code;
  document.querySelector('#verdict-label').textContent = label;
  document.querySelector('#verdict-line').textContent = line;
  verdict.classList.remove('flash'); void verdict.offsetWidth; verdict.classList.add('flash');
}
function resetViews() {
  identityView.hidden = true; identityView.replaceChildren(); view.replaceChildren(); orgNames = new Map();
  setVerdict('none', '···', 'No request yet', 'Sign in, pick an organization, then an endpoint.');
}
function markActiveMembership() {
  for (const item of identityView.querySelectorAll('.membership')) item.dataset.active = String(item.dataset.org === organization.value);
}
function renderIdentity(data) {
  const list = el('ul', { className: 'memberships' });
  for (const tenant of data.organizations || []) {
    list.append(el('li', { className: 'membership', 'data-org': tenant.organizationId },
      el('div', {}, el('strong', { text: tenant.organizationName }), el('small', { text: `${tenant.organizationSlug ?? ''} · ${tenant.status ?? ''}` })),
      el('div', { className: 'roles' }, ...tenant.roles.map(role => el('span', { className: 'role', 'data-role': role, text: role })))));
  }
  if (!list.children.length) list.append(el('li', { className: 'empty-rows', text: 'Authenticated, but no active organization memberships.' }));
  identityView.replaceChildren(
    el('div', { className: 'id-row' }, el('span', { text: 'Internal user' }), el('code', { text: shortId(data.userId), title: data.userId })),
    list);
  identityView.hidden = false;
  markActiveMembership();
}

// Plain-language reading of each status code, shown under the verdict during the demo.
const explain = {
  200: ['Allowed', 'Valid token, active membership in this organization, and a matching Casbin allow with no deny.'],
  400: ['Rejected', 'The request was malformed, so it never reached a policy decision.'],
  401: ['Unauthenticated', 'Token rejected: expired, revoked, or the Keycloak session has ended.'],
  403: ['Denied', 'Your roles in this organization do not permit this. Roles from other organizations never apply.'],
  404: ['Not found in this tenant', 'Lookups are scoped to the selected organization, so other tenants\' data is invisible.'],
  503: ['Failed closed', 'A dependency was unavailable, so the request was denied instead of guessed.'],
};
function rowsFor(id, data) {
  const pick = {
    resources: () => (data.resources || []).map(r => [r.title, r.status, `${r.resource_type} · ${shortId(r.id)}`, r.status === 'published' ? 'allow' : undefined]),
    members: () => (data.members || []).map(m => [m.displayName, m.status, `user ${shortId(m.userId)}`, m.status === 'active' ? 'allow' : 'deny']),
    submissions: () => (data.submissions || []).map(s => [String(s.content ?? '').slice(0, 80) || 'Submission',
      s.grade === null || s.grade === undefined ? 'ungraded' : `grade ${s.grade}`, `course ${shortId(s.course_id)} · learner ${shortId(s.user_id)}`]),
    audit: () => (data.events || []).map(e => [e.action, e.decision, `${clock(e.timestamp)} · ${e.reason ?? ''} · ${shortId(e.correlation_id)}`, e.decision === 'allow' ? 'allow' : 'deny']),
    sessions: () => (data.sessions || []).map(s => [`Session ${shortId(s.id)}`, Object.values(s.clients || {}).join(', ') || 'session',
      `started ${clock(s.start)} · last seen ${clock(s.lastAccess)}`]),
  };
  return pick[id]?.() ?? [];
}
function renderResponse(id, httpStatus, data) {
  if (httpStatus >= 400) {
    view.replaceChildren(el('div', { className: 'empty-rows' }, el('code', { text: data.code ?? `HTTP ${httpStatus}` }), ` ${data.error ?? ''}`));
    return;
  }
  const rows = rowsFor(id, data);
  const list = el('ul', { className: 'rows' }, ...rows.map(([primary, pill, secondary, tone]) => el('li', {},
    el('span', { className: 'primary-text', text: primary }), el('span', { className: 'pill', 'data-tone': tone, text: pill }),
    el('span', { className: 'secondary', text: secondary }))));
  view.replaceChildren(
    el('p', { className: 'view-head' }, el('span', { text: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` }),
      el('span', { text: id === 'sessions' ? 'your Keycloak sessions' : 'scoped to this organization' })),
    rows.length ? list : el('div', { className: 'empty-rows', text: 'Allowed, but nothing here is visible to you.' }));
}
function appendLog(label, where, httpStatus) {
  log.querySelector('.log-empty')?.remove();
  log.prepend(el('li', {}, el('time', { text: clock() }), el('span', { className: 'what' }, `${label} `, el('span', { className: 'where', text: where })),
    el('b', { 'data-tone': httpStatus < 400 ? 'allow' : 'deny', text: String(httpStatus) })));
  while (log.children.length > 10) log.lastElementChild.remove();
}

function controls() {
  for (const id of ['login', 'enterprise']) document.getElementById(id).disabled = busy;
  for (const id of ['refresh', 'logout']) document.getElementById(id).disabled = busy || !tokens;
  organization.disabled = busy || !tokens || !organization.value;
  for (const id of ['resources', 'members', 'submissions', 'audit']) document.getElementById(id).disabled = busy || !tokens || !organization.value;
  document.getElementById('sessions').disabled = busy || !tokens;
  if (busy) status.dataset.state = 'busy';
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
  orgNames = new Map((data.organizations || []).map(tenant => [tenant.organizationId, tenant.organizationName]));
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
  renderIdentity(data);
  setStatus('Signed in', 'ok');
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
  catch (error) {
    tokens = undefined; profile.textContent = ''; organization.replaceChildren(); result.textContent = ''; resetViews();
    setStatus(error.message, 'error');
  }
  finally {
    busy = false; controls();
    if (status.dataset.state === 'busy') status.dataset.state = tokens ? 'ok' : 'idle';
  }
}
document.getElementById('login').onclick = () => run(() => login(false));
document.getElementById('enterprise').onclick = () => run(() => login(true));
organization.onchange = () => {
  result.textContent = 'Tenant changed; request resources to re-evaluate current permissions.';
  view.replaceChildren(); markActiveMembership();
  setVerdict('info', '↺', `Switched to ${orgNames.get(organization.value) ?? 'organization'}`,
    'Nothing is cached: the next request re-checks membership and roles for this tenant.');
  controls();
};
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
  setStatus(response.ok ? 'Signed in; request allowed' : `Signed in; request denied (${response.status})`, response.ok ? 'ok' : 'denied');
  const route = `/${path.split('?')[0]}`;
  const where = tenantRequired ? orgNames.get(organization.value) ?? shortId(organization.value) : 'own sessions';
  const [label, why] = explain[response.status] ?? (response.ok ? explain[200] : ['Error', 'Unexpected response.']);
  setVerdict(response.ok ? 'allow' : 'deny', String(response.status), label, `GET /api/v1${route} · ${where}\n${why}`);
  for (const button of document.querySelectorAll('.endpoint')) button.dataset.last = String(button.id === id);
  renderResponse(id, response.status, data);
  appendLog(route, where, response.status);
});
document.getElementById('refresh').onclick = () => run(async () => {
  const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  if (next.token_type?.toLowerCase() !== 'bearer') throw new Error('Unsupported token type');
  // OIDC refresh responses may omit nonce; a present nonce must still match,
  // and the verified issuer/audience/subject must remain the original identity.
  await validateIdToken(next.id_token, sessionNonce, true);
  tokens = next;
  await showProfile();
  setStatus('Signed in; refresh token rotated', 'ok');
  setVerdict('info', '⟳', 'Refresh token rotated', 'Keycloak issued a new token pair. Reusing the old refresh token now kills the whole chain.');
});
document.getElementById('logout').onclick = () => run(async () => {
  const idToken = tokens.id_token;
  tokens = undefined; profile.textContent = ''; resetViews();
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
