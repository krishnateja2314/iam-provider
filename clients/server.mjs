import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const files = new Map([
  ['/', ['web.html', 'text/html']], ['/web.html', ['web.html', 'text/html']],
  ['/mobile.html', ['mobile.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);
createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!file || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(fileURLToPath(new URL(file[0], import.meta.url)));
    res.writeHead(200, {
      'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' http://localhost:8180 http://localhost:3100; form-action 'self' http://localhost:8180; frame-ancestors 'none'; base-uri 'none'",
    });
    res.end(body);
  } catch { res.writeHead(500); res.end('Client unavailable'); }
}).listen(5173, '0.0.0.0', () => console.log('PKCE clients: http://localhost:5173/web.html and /mobile.html'));
