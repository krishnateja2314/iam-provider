// AG02 demo: the assistant agent acts for a user through a delegation the user created.
// 1. Sign in to the web client as a user, pick a tenant, press "POST /delegations".
// 2. Copy the delegation ID from the response, then run:
//      node scripts/demo-delegation.mjs <delegation-id> [organization-id]
// The script gets a client-credentials token for iam-agent-assistant (synthetic lab secret) and
// calls the API with and without the delegation. It prints statuses only; no token is printed.
const [delegationId, organizationId = '10000000-0000-0000-0000-000000000001'] = process.argv.slice(2);
if (!delegationId) { console.error('Usage: node scripts/demo-delegation.mjs <delegation-id> [organization-id]'); process.exit(2); }
const host = process.env.IAM_PUBLIC_HOST || 'localhost';
const issuer = `http://${host}:8180/realms/iam-platform`;
const api = process.env.IAM_API_BASE || `http://${host}:3100`;
const secret = process.env.KEYCLOAK_ASSISTANT_CLIENT_SECRET || 'dev-agent-assistant-secret';
const GLOBEX = '10000000-0000-0000-0000-000000000002';

const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'iam-agent-assistant', client_secret: secret }) });
if (!tokenResponse.ok) { console.error(`Token request failed: ${tokenResponse.status}`); process.exit(1); }
const token = (await tokenResponse.json()).access_token;

async function call(label, path, org, delegation) {
  const response = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-organization-id': org,
    ...(delegation ? { 'x-delegation-id': delegation } : {}) } });
  const body = await response.json().catch(() => ({}));
  const rows = body.resources?.length ?? body.submissions?.length;
  console.log(`${String(response.status).padEnd(4)} ${label}${rows !== undefined ? ` (${rows} rows)` : ''}${body.code ? ` ${body.code}` : ''}`);
}

await call('GET /resources   without delegation (agent has no authority of its own)', '/api/v1/resources', organizationId);
await call('GET /resources   with delegation', '/api/v1/resources', organizationId, delegationId);
await call('GET /submissions with delegation (only the delegator\'s own)', '/api/v1/submissions', organizationId, delegationId);
await call('GET /members     with delegation (admin action, never delegable)', '/api/v1/members', organizationId, delegationId);
await call('GET /resources   with delegation in another tenant', '/api/v1/resources', organizationId === GLOBEX ? '10000000-0000-0000-0000-000000000001' : GLOBEX, delegationId);
console.log('Revoke the delegation in the web client (or DELETE /api/v1/delegations/<id>) and rerun: the delegated calls become 401.');
