// Mutation check: do the security tests actually detect broken security guards?
//
// Contract (W3 mentor review, FB003):
//  - Requires the running Compose stack (backend + PostgreSQL). Nothing is mocked here.
//  - The working tree is NEVER modified. Each run happens in a disposable copy of the
//    backend source inside the backend container, deleted afterwards.
//  - The container's source must be byte-identical to this checkout (rebuild otherwise).
//  - A clean baseline must pass first, and every expected test must exist and pass in it.
//  - One mutation at a time. Its anchor must occur exactly once, or the run is aborted.
//  - A mutation is KILLED only if every named expected test fails with an assertion
//    failure. Suite crashes, import errors or connection errors are INCONCLUSIVE.
//
// Exit codes: 0 all mutations killed; 1 a mutation survived; 2 inconclusive/infrastructure.
//
// Usage:  docker compose up -d --build --wait
//         node scripts/verify-test-independence.mjs [--only M3,M4] [--json out.json]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backend = join(root, 'backend');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;

export const MUTATIONS = [
  { id: 'M1', guard: 'Tenant membership check in tenantContextHook',
    file: 'src/middleware.ts',
    find: 'const membership = await validateMembership(request.auth.userId,orgId);',
    replace: 'const membership = { organizationSlug: "mutant", membershipId: "mutant", roles: ["admin"], membershipStatus: "active" };',
    expect: ['accessing org where user has no membership returns 403'] },
  { id: 'M2', guard: 'JWT signature verification',
    file: 'src/modules/auth/token-validator.ts',
    find: 'const { payload } = await jose.jwtVerify(token, keySet, {',
    replace: 'const payload = jose.decodeJwt(token); void ({',
    expect: ['rejects an invalid signature with the same trusted kid'] },
  { id: 'M3', guard: 'Tenant filter on submission lookup in authorize()',
    file: 'src/modules/authorization/authorization-engine.ts',
    find: ".where('id','=',submissionId).where('organization_id','=',request.organization).executeTakeFirst();",
    replace: ".where('id','=',submissionId).executeTakeFirst();",
    expect: ['a REAL Globex submission cannot be read or graded through the Acme selector'] },
  { id: 'M4', guard: 'Consent route admits suspended members for withdrawal',
    file: 'src/routes.ts',
    find: "app.post('/api/v1/consents',{preHandler:ownMembershipHooks,",
    replace: "app.post('/api/v1/consents',{preHandler:tenantHooks,",
    expect: ['withdrawal remains possible during suspension', 'permits only own withdrawal'] },
  { id: 'M5', guard: 'Fatal security-config check before listen()',
    file: 'src/server.ts',
    find: '  assertSecurityConfig();\n',
    replace: '\n',
    expect: ['exits 1 before listening'] },
  { id: 'M6', guard: 'Provider outage reported as dependency error (503), not bad credential',
    file: 'src/modules/auth/session-service.ts',
    find: "throw new DependencyError('Provider session verification unavailable');",
    replace: "throw new AuthenticationError('Provider session verification unavailable');",
    expect: ['denies with exactly 503 DEPENDENCY_UNAVAILABLE'] },
  { id: 'M7', guard: 'Casbin explicit-deny precedence',
    file: 'src/modules/authorization/authorization-engine.ts',
    find: 'e = some(where (p.eft == allow)) && !some(where (p.eft == deny))',
    replace: 'e = some(where (p.eft == allow))',
    expect: ['explicit deny overrides an admin allow', 'explicit deny on one role wins over an allow on another role'] },
  // W5 / AG01 service principal guards.
  { id: 'M8', guard: 'Service principal registry: disabled principal refused',
    file: 'src/modules/service-principal/service-principal-service.ts',
    find: "if (!row || row.status !== 'active') throw new AuthenticationError('Unregistered or disabled service principal');",
    replace: "if (!row) throw new AuthenticationError('Unregistered or disabled service principal');",
    expect: ['unregistered and disabled service principals are rejected with 401'] },
  { id: 'M9', guard: 'Service token bound to its client service account at introspection',
    file: 'src/modules/auth/session-service.ts',
    find: "claims.client_id !== client || claims.username !== `service-account-${client}`.toLowerCase() ||",
    replace: 'claims.client_id !== client ||',
    expect: ['rejects a human user token relabelled as a service token'] },
  { id: 'M10', guard: 'Human-only routes refuse service principals',
    file: 'src/middleware.ts',
    find: 'if (!allowService) {',
    replace: 'if (false) {',
    expect: ['human-only routes refuse service principals'] },
  { id: 'M11', guard: 'Service grant matches the exact action',
    file: 'src/modules/service-principal/service-principal-service.ts',
    find: ".where('resource', '=', resource).where('action', '=', request.action)",
    replace: ".where('resource', '=', resource)",
    expect: ['cannot perform admin or other ungranted actions in Acme'] },
].filter(m => !only || only.includes(m.id));

const INFRA = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|Connection terminated|password authentication failed|Cannot find module|SyntaxError|Transform failed/i;

// Runs inside the backend container. Builds a disposable copy, applies at most one mutation, runs vitest.
const helper = String.raw`
import fs from 'node:fs'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
const spec = JSON.parse(process.env.MUTATION_SPEC);
const emit = value => process.stdout.write('\n@@RESULT@@' + JSON.stringify(value));
if (spec.mode === 'hash') {
  const out = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name;
    if (e.isDirectory()) walk(p); else out[p.slice(5)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
  walk('/app/src'); walk('/app/tests');
  emit(out); process.exit(0);
}
const dir = '/tmp/iam-mutation-' + spec.id;
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
try {
  for (const f of ['src', 'tests', 'package.json', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.test.json'])
    if (fs.existsSync('/app/' + f)) fs.cpSync('/app/' + f, dir + '/' + f, { recursive: true });
  fs.symlinkSync('/app/node_modules', dir + '/node_modules');
  if (spec.file) {
    const target = dir + '/' + spec.file;
    const source = fs.readFileSync(target, 'utf8');
    const count = source.split(spec.find).length - 1;
    if (count !== 1) { emit({ infra: 'Mutation anchor found ' + count + ' times in ' + spec.file + ' (must be exactly 1)' }); process.exit(0); }
    fs.writeFileSync(target, source.replace(spec.find, spec.replace));
    if (fs.readFileSync(target, 'utf8') === source) { emit({ infra: 'Mutation did not change ' + spec.file }); process.exit(0); }
  }
  const run = spawnSync('npx', ['vitest', 'run', '--reporter=json', '--outputFile=' + dir + '/result.json'], {
    cwd: dir, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, KEYCLOAK_INTROSPECTION: 'false', RUN_DATABASE_TESTS: '1' } });
  let report = null; try { report = JSON.parse(fs.readFileSync(dir + '/result.json', 'utf8')); } catch {}
  emit({ exitCode: run.status, signal: run.signal, stderrTail: (run.stderr || '').slice(-1500), report: report && {
    numTotalTests: report.numTotalTests, numPassedTests: report.numPassedTests, numFailedTests: report.numFailedTests,
    numPendingTests: report.numPendingTests,
    files: report.testResults.map(f => ({ name: f.name.replace(dir + '/', ''), status: f.status, message: f.message || '',
      tests: f.assertionResults.map(a => ({ name: a.fullName, status: a.status, failure: (a.failureMessages || []).join('\n').slice(0, 600) })) })) } });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
`;

function inContainer(spec) {
  let stdout;
  try {
    stdout = execFileSync('docker', ['compose', 'exec', '-T', '-e', `MUTATION_SPEC=${JSON.stringify(spec)}`, 'backend', 'node', '--input-type=module', '-'],
      { cwd: root, input: helper, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    return { infra: `Could not run in backend container (is the stack up?): ${String(error.stderr || error.message).trim().slice(0, 400)}` };
  }
  const marker = stdout.lastIndexOf('@@RESULT@@');
  if (marker < 0) return { infra: 'Container helper produced no result' };
  return JSON.parse(stdout.slice(marker + '@@RESULT@@'.length));
}

function hostHashes() {
  const out = {};
  const walk = dir => { for (const name of readdirSync(dir)) { const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else out[relative(backend, p).split(sep).join('/')] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
  walk(join(backend, 'src')); walk(join(backend, 'tests'));
  return out;
}

const tests = run => run.report.files.flatMap(f => f.tests);
function infraProblem(run) {
  if (run.infra) return run.infra;
  if (!run.report) return `Vitest produced no JSON report (exit ${run.exitCode}${run.signal ? `, ${run.signal}` : ''}). ${run.stderrTail}`;
  const crashed = run.report.files.filter(f => f.status === 'failed' && (f.message || f.tests.length === 0));
  if (crashed.length) return `Suite-level failure (not an assertion): ${crashed.map(f => `${f.name}: ${f.message.slice(0, 300)}`).join(' | ')}`;
  const infraFailures = tests(run).filter(t => t.status === 'failed' && INFRA.test(t.failure));
  if (infraFailures.length) return `Infrastructure error inside tests: ${infraFailures[0].name}: ${infraFailures[0].failure.slice(0, 300)}`;
  return undefined;
}
const matching = (run, needle) => tests(run).filter(t => t.name.includes(needle));

function git(...a) { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim(); } catch { return 'unknown'; } }
const summary = { startedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--', 'backend', 'scripts') !== '', baseline: null, mutations: [] };
const finish = code => {
  summary.finishedAt = new Date().toISOString(); summary.exitCode = code;
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
  process.exit(code);
};

console.log(`Commit ${summary.commit}${summary.dirty ? ' (backend/scripts have uncommitted changes)' : ''}`);
const before = hostHashes();

// 0. The container must be running exactly this checkout's source.
const containerHashes = inContainer({ mode: 'hash' });
if (containerHashes.infra) { console.error(`INCONCLUSIVE: ${containerHashes.infra}`); finish(2); }
const drift = [...new Set([...Object.keys(before), ...Object.keys(containerHashes)])].filter(f => before[f] !== containerHashes[f]);
if (drift.length) { console.error(`INCONCLUSIVE: container source differs from checkout (${drift.slice(0, 5).join(', ')}). Run: docker compose up -d --build --wait backend`); finish(2); }
console.log('Container source matches checkout.');

// 1. Baseline: everything passes and every expected test exists.
console.log('Baseline (no mutation)...');
const baseline = inContainer({ id: 'baseline' });
const baseProblem = infraProblem(baseline);
if (baseProblem) { console.error(`INCONCLUSIVE baseline: ${baseProblem}`); finish(2); }
summary.baseline = { passed: baseline.report.numPassedTests, failed: baseline.report.numFailedTests, skipped: baseline.report.numPendingTests };
console.log(`  passed ${summary.baseline.passed}, failed ${summary.baseline.failed}, skipped ${summary.baseline.skipped}`);
if (baseline.report.numFailedTests !== 0) {
  console.error('INCONCLUSIVE: baseline has failing tests; a mutation result would mean nothing.');
  for (const t of tests(baseline).filter(t => t.status === 'failed')) console.error(`  FAILED: ${t.name}`);
  finish(2);
}
for (const m of MUTATIONS) for (const needle of m.expect) {
  const found = matching(baseline, needle);
  if (!found.length || found.some(t => t.status !== 'passed')) { console.error(`INCONCLUSIVE: expected test "${needle}" (${m.id}) is missing or not passing in baseline.`); finish(2); }
}

// 2. One mutation at a time.
let survived = 0; let inconclusive = 0;
for (const m of MUTATIONS) {
  process.stdout.write(`${m.id} ${m.guard}: `);
  const run = inContainer({ id: m.id, file: m.file, find: m.find, replace: m.replace });
  const problem = infraProblem(run);
  const record = { id: m.id, guard: m.guard, file: m.file, expect: m.expect };
  if (problem) { inconclusive++; Object.assign(record, { verdict: 'INCONCLUSIVE', reason: problem }); console.log(`INCONCLUSIVE - ${problem}`); summary.mutations.push(record); continue; }
  const failed = tests(run).filter(t => t.status === 'failed').map(t => t.name);
  const missed = m.expect.filter(needle => !matching(run, needle).some(t => t.status === 'failed'));
  Object.assign(record, { verdict: missed.length ? 'SURVIVED' : 'KILLED', failedTests: failed, notFailed: missed,
    passed: run.report.numPassedTests, failed: run.report.numFailedTests });
  summary.mutations.push(record);
  if (missed.length) { survived++; console.log(`SURVIVED - expected failures did not occur: ${missed.join('; ')}`); }
  else console.log(`KILLED (${failed.length} failing test${failed.length === 1 ? '' : 's'})`);
  for (const name of failed) console.log(`    x ${name}`);
}

// 3. The checkout was never touched.
const after = hostHashes();
const touched = Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]);
if (touched.length) { console.error(`ERROR: working tree changed during the run: ${touched.join(', ')}`); finish(2); }
console.log(`\nWorking tree unchanged. ${MUTATIONS.length - survived - inconclusive} killed, ${survived} survived, ${inconclusive} inconclusive.`);
finish(inconclusive ? 2 : survived ? 1 : 0);
