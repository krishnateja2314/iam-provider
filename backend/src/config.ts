// Security configuration contract, checked before the API binds a port.
// The request-time check in token-validator.ts stays as defence in depth.

export class ConfigurationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Unsafe or incomplete configuration: ${problems.join('; ')}`);
    this.name = 'ConfigurationError';
  }
}

type Env = Record<string, string | undefined>;

/** Introspection may be disabled only for signed-fixture test runs (NODE_ENV=test). */
export function introspectionDisableAllowed(env: Env = process.env): boolean {
  return env.NODE_ENV === 'test';
}

/**
 * Returns the list of problems; empty means the configuration may start.
 * Messages name variables only, never their values, so they are safe to log.
 */
export function securityConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  for (const name of ['JWT_ISSUER', 'JWT_AUDIENCE', 'DATABASE_URL']) {
    if (!env[name]?.trim()) problems.push(`${name} is required`);
  }
  if (env.JWT_ISSUER?.trim()) {
    try { new URL(env.JWT_ISSUER); } catch { problems.push('JWT_ISSUER must be an absolute URL'); }
  }
  const introspection = env.KEYCLOAK_INTROSPECTION;
  if (introspection !== undefined && introspection !== 'true' && introspection !== 'false') {
    problems.push('KEYCLOAK_INTROSPECTION must be "true" or "false"');
  }
  if (introspection === 'false' && !introspectionDisableAllowed(env)) {
    problems.push('KEYCLOAK_INTROSPECTION=false is only allowed when NODE_ENV=test');
  }
  if (introspection !== 'false' && !env.KEYCLOAK_CLIENT_SECRET?.trim()) {
    problems.push('KEYCLOAK_CLIENT_SECRET is required when introspection is enabled');
  }
  if (env.NODE_ENV === 'production' && !env.KEYCLOAK_ALLOWED_AZP?.trim()) {
    problems.push('KEYCLOAK_ALLOWED_AZP must list the permitted clients in production');
  }
  return problems;
}

export function assertSecurityConfig(env: Env = process.env): void {
  const problems = securityConfigProblems(env);
  if (problems.length) throw new ConfigurationError(problems);
}
