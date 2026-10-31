// Demonstrates that the browser clients take issuer/API/CSP origins from runtime configuration.
// Starts clients/server.mjs twice (default and an alternate host) on free ports and checks
// /config.js and the Content-Security-Policy header. No source file is edited. Needs no Docker.
//
// Usage: node scripts/verify-client-config.mjs [alternate-host]   (default 192.0.2.10, TEST-NET-1)
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const clients = fileURLToPath(new URL('../clients/', import.meta.url));
const alternate = process.argv[2] || '192.0.2.10';
let failures = 0;
const check = (condition, label) => { console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`); if (!condition) failures++; };

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = server.address(); server.close(() => resolve(port));
  });
});

async function serve(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: clients, env: { ...process.env, ...env, CLIENT_PORT: String(port), CLIENT_BIND: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const response = await fetch(`http://127.0.0.1:${port}/config.js`).catch(() => undefined);
    if (response?.ok) {
      const page = await fetch(`http://127.0.0.1:${port}/mobile.html`);
      const result = { config: await response.text(), csp: page.headers.get('content-security-policy') ?? '', html: await page.text() };
      child.kill();
      return result;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('client server did not start');
}

const local = await serve({});
check(local.config.includes('"issuer":"http://localhost:8180/realms/iam-platform"') && local.config.includes('"apiBase":"http://localhost:3100"'), 'default config targets the local lab');

const alt = await serve({ IAM_ISSUER: `http://${alternate}:8180/realms/iam-platform`, IAM_API_BASE: `http://${alternate}:3100` });
check(alt.config.includes(`"issuer":"http://${alternate}:8180/realms/iam-platform"`), `alternate issuer served in /config.js (${alternate})`);
check(alt.config.includes(`"apiBase":"http://${alternate}:3100"`), 'alternate API base served in /config.js');
check(alt.csp.includes(`connect-src 'self' http://${alternate}:8180 http://${alternate}:3100`), 'CSP connect-src follows the configured origins');
check(alt.csp.includes(`form-action 'self' http://${alternate}:8180`), 'CSP form-action follows the configured issuer');
check(!alt.csp.includes('localhost'), 'alternate CSP contains no localhost origin');
check(alt.html.indexOf('/config.js') > -1 && alt.html.indexOf('/config.js') < alt.html.indexOf('/app.js'), 'config.js loads before app.js');

const app = await readFile(new URL('app.js', `file:///${clients.replace(/\\/g, '/')}`), 'utf8');
check(!/localhost|127\.0\.0\.1|:8180|:3100/.test(app), 'clients/app.js contains no hard-coded host or port');

const rejected = await new Promise(resolve => {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: clients, env: { ...process.env, IAM_ISSUER: 'javascript:alert(1)' }, stdio: 'ignore' });
  child.once('exit', code => resolve(code));
  setTimeout(() => { child.kill(); resolve('still running'); }, 5000);
});
check(rejected === 1, 'non-http issuer is refused at client-server startup');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll client configuration checks passed');
process.exit(failures ? 1 : 0);
