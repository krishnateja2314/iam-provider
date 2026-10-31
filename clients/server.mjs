import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Runtime configuration: one source for the browser's issuer/API URLs AND the CSP that permits them.
// Defaults are the synthetic local lab. To reach the stack from a phone on the same network, set
// IAM_PUBLIC_HOST (Compose) or IAM_ISSUER/IAM_API_BASE directly; no source edit is required.
function httpOrigin(name, value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute URL`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${name} must use http or https`);
  return url;
}
export function loadClientConfig(env = process.env) {
  const issuer = httpOrigin('IAM_ISSUER', env.IAM_ISSUER || 'http://localhost:8180/realms/iam-platform');
  const apiBase = httpOrigin('IAM_API_BASE', env.IAM_API_BASE || 'http://localhost:3100');
  const port = Number(env.CLIENT_PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CLIENT_PORT must be a TCP port');
  return {
    issuer: issuer.href.replace(/\/$/, ''),
    apiBase: apiBase.origin,
    port,
    bind: env.CLIENT_BIND || '0.0.0.0',
    csp: `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${issuer.origin} ${apiBase.origin}; form-action 'self' ${issuer.origin}; frame-ancestors 'none'; base-uri 'none'`,
  };
}

const config = loadClientConfig();
const configScript = `window.IAM_CONFIG = Object.freeze(${JSON.stringify({ issuer: config.issuer, apiBase: config.apiBase })});\n`;
const files = new Map([
  ['/', ['web.html', 'text/html']], ['/web.html', ['web.html', 'text/html']],
  ['/mobile.html', ['mobile.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);
const headers = type => ({
  'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': config.csp,
});
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://placeholder').pathname;
  if (req.method === 'GET' && pathname === '/config.js') { res.writeHead(200, headers('text/javascript')); res.end(configScript); return; }
  const file = files.get(pathname);
  if (!file || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(fileURLToPath(new URL(file[0], import.meta.url)));
    res.writeHead(200, headers(file[1]));
    res.end(body);
  } catch { res.writeHead(500); res.end('Client unavailable'); }
}).listen(config.port, config.bind, () => console.log(`PKCE clients on port ${config.port}: issuer ${config.issuer}, API ${config.apiBase}`));
