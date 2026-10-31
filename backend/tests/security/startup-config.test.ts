// Fatal startup configuration contract.
// Spawns the real server entry point as a child process; needs no database or provider,
// because validation happens before any port is bound or connection opened.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { securityConfigProblems, assertSecurityConfig, ConfigurationError } from '../../src/config.js';

const backendRoot = path.resolve(import.meta.dirname, '../..');

const safeProduction = {
  NODE_ENV: 'production',
  JWT_ISSUER: 'http://localhost:8180/realms/iam-platform',
  JWT_AUDIENCE: 'iam-backend',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:19/unused',
  KEYCLOAK_INTROSPECTION: 'true',
  KEYCLOAK_CLIENT_SECRET: 'test-only-secret',
  KEYCLOAK_ALLOWED_AZP: 'iam-web,iam-mobile',
};

describe('securityConfigProblems (unit)', () => {
  it('accepts the documented production configuration', () => {
    expect(securityConfigProblems(safeProduction)).toEqual([]);
    expect(() => assertSecurityConfig(safeProduction)).not.toThrow();
  });
  it.each([
    ['production with introspection disabled', { KEYCLOAK_INTROSPECTION: 'false' }, 'KEYCLOAK_INTROSPECTION=false is only allowed when NODE_ENV=test'],
    ['development with introspection disabled', { NODE_ENV: 'development', KEYCLOAK_INTROSPECTION: 'false' }, 'KEYCLOAK_INTROSPECTION=false is only allowed when NODE_ENV=test'],
    ['unrecognised introspection value', { KEYCLOAK_INTROSPECTION: 'no' }, 'KEYCLOAK_INTROSPECTION must be "true" or "false"'],
    ['missing introspection client secret', { KEYCLOAK_CLIENT_SECRET: '' }, 'KEYCLOAK_CLIENT_SECRET is required when introspection is enabled'],
    ['production without azp allowlist', { KEYCLOAK_ALLOWED_AZP: '' }, 'KEYCLOAK_ALLOWED_AZP must list the permitted clients in production'],
    ['missing issuer', { JWT_ISSUER: '' }, 'JWT_ISSUER is required'],
    ['relative issuer', { JWT_ISSUER: 'realms/iam-platform' }, 'JWT_ISSUER must be an absolute URL'],
  ])('rejects %s', (_label, override, problem) => {
    const env = { ...safeProduction, ...override };
    expect(securityConfigProblems(env)).toContain(problem);
    expect(() => assertSecurityConfig(env)).toThrow(ConfigurationError);
  });
  it('fixture mode (introspection disabled) is accepted only for NODE_ENV=test', () => {
    expect(securityConfigProblems({ ...safeProduction, NODE_ENV: 'test', KEYCLOAK_INTROSPECTION: 'false', KEYCLOAK_ALLOWED_AZP: '' })).toEqual([]);
  });
  it('problem messages never contain configured secret values', () => {
    const problems = securityConfigProblems({ ...safeProduction, KEYCLOAK_INTROSPECTION: 'false', KEYCLOAK_ALLOWED_AZP: '' });
    expect(problems.join(' ')).not.toContain(safeProduction.KEYCLOAK_CLIENT_SECRET);
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

function startServer(env: Record<string, string>) {
  // Explicit, minimal environment: nothing inherited from the test runner's own settings.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: backendRoot,
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', LOG_LEVEL: 'warn', BACKEND_HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  return { child, exited, output: () => ({ stdout, stderr }) };
}

describe('server entry point (subprocess)', () => {
  it('production with KEYCLOAK_INTROSPECTION=false exits 1 before listening', async () => {
    const port = await freePort();
    const server = startServer({ ...safeProduction, KEYCLOAK_INTROSPECTION: 'false', BACKEND_PORT: String(port) });
    const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 20000));
    const code = await Promise.race([server.exited, timeout]);
    if (code === 'timeout') server.child.kill();
    expect(code).toBe(1);
    expect(server.output().stderr).toContain('Startup refused: KEYCLOAK_INTROSPECTION=false is only allowed when NODE_ENV=test');
    expect(server.output().stdout).not.toContain('IAM API ready');
    expect(await canConnect(port)).toBe(false);
  }, 30000);

  it('positive control: the same entry point with safe production config listens and answers /health', async () => {
    const port = await freePort();
    const server = startServer({ ...safeProduction, BACKEND_PORT: String(port) });
    try {
      let status = 0;
      for (let attempt = 0; attempt < 100 && status !== 200; attempt++) {
        status = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.status).catch(() => 0);
        if (status !== 200) await new Promise(r => setTimeout(r, 200));
      }
      expect(status).toBe(200);
    } finally {
      server.child.kill();
      await server.exited;
    }
  }, 30000);
});
