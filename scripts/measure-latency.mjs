// Local latency observation for the authenticated request path (W5 performance experiment).
// Three runs of N sequential requests for each series, after a warm-up:
//   health      GET /health (no authentication; HTTP + framework floor)
//   introspect  POST to the provider's introspection endpoint (the uncached per-request check)
//   agent-list  GET /api/v1/resources as the AG01 service principal (JWT + introspection +
//               registry + tenant gate + grant + query + audit insert)
// Prints only timings and status counts; no token is printed or stored.
// This is a single-machine observation, not a benchmark or a service-level claim.
//
// Run it INSIDE the backend container, so Docker Desktop's host port forwarding (a fixed ~15 ms
// per request on the Windows lab host, measured even for /health) is not part of the numbers:
//   docker compose exec -T backend node --input-type=module - < scripts/measure-latency.mjs
// From the host it also works (node scripts/measure-latency.mjs) but then measures the forwarder.
// Options are environment variables because stdin carries the script: IAM_MEASURE_RUNS (3),
// IAM_MEASURE_REQUESTS (200).
const runs = Number(process.env.IAM_MEASURE_RUNS || 3);
const requests = Number(process.env.IAM_MEASURE_REQUESTS || 200);
// Inside the container KEYCLOAK_INTERNAL_URL points at the provider on the Docker network.
// The token issuer is fixed by KC_HOSTNAME, not by the address used to reach the provider.
const provider = process.env.KEYCLOAK_INTERNAL_URL || 'http://127.0.0.1:8180';
const issuer = `${provider.replace(/\/$/, '')}/realms/iam-platform`;
const api = process.env.IAM_MEASURE_API || `http://127.0.0.1:${process.env.BACKEND_PORT || '3100'}`;
const ACME = '10000000-0000-0000-0000-000000000001';
const agentSecret = process.env.KEYCLOAK_AGENT_CLIENT_SECRET || 'dev-agent-reporting-secret';
const backendSecret = process.env.KEYCLOAK_CLIENT_SECRET || 'dev-client-secret-change-me';

async function agentToken() {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'iam-agent-reporting', client_secret: agentSecret }) });
  if (!response.ok) throw new Error(`Agent token request failed (${response.status})`);
  return (await response.json()).access_token;
}

// Tokens live 60 s; renew well before expiry so a run never measures a 401.
let token; let tokenAt = 0;
async function currentToken() {
  if (!token || performance.now() - tokenAt > 30000) { token = await agentToken(); tokenAt = performance.now(); }
  return token;
}

const series = {
  health: async () => fetch(`${api}/health`),
  introspect: async () => fetch(`${issuer}/protocol/openid-connect/token/introspect`, { method: 'POST',
    body: new URLSearchParams({ client_id: 'iam-backend', client_secret: backendSecret, token: await currentToken() }) }),
  'agent-list': async () => fetch(`${api}/api/v1/resources`, { headers: { authorization: `Bearer ${await currentToken()}`, 'x-organization-id': ACME } }),
};

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const round = value => Math.round(value * 100) / 100;

console.log(`Latency observation: ${runs} runs x ${requests} sequential requests per series, API ${api}, ${new Date().toISOString()}`);
const results = {};
for (const [name, send] of Object.entries(series)) {
  for (let i = 0; i < 20; i++) await (await send()).arrayBuffer(); // warm-up, not recorded
  results[name] = [];
  for (let run = 1; run <= runs; run++) {
    const samples = []; const statuses = {};
    for (let i = 0; i < requests; i++) {
      await currentToken(); // renewal is outside the timed window
      const started = performance.now();
      const response = await send();
      await response.arrayBuffer();
      samples.push(performance.now() - started);
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
    }
    samples.sort((a, b) => a - b);
    const row = { series: name, run, p50: round(percentile(samples, 50)), p95: round(percentile(samples, 95)), p99: round(percentile(samples, 99)),
      mean: round(samples.reduce((a, b) => a + b, 0) / samples.length), statuses };
    results[name].push(row);
    console.log(JSON.stringify(row));
  }
}
const ok = Object.values(results).flat().every(row => Object.keys(row.statuses).every(status => status === '200'));
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ summary: 'median across runs (ms)', ...Object.fromEntries(Object.entries(results).map(([name, rows]) => [name, { p50: median(rows.map(r => r.p50)), p95: median(rows.map(r => r.p95)) }])), allStatus200: ok }));
process.exitCode = ok ? 0 : 1;
