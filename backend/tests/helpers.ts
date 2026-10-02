// Test helpers: JWT generation for testing, DB connection, etc.
import * as jose from 'jose';
import { v4 as uuidv4 } from 'uuid';

// Generate a test RSA key pair for signing test JWTs
let testKeyPair: Awaited<ReturnType<typeof jose.generateKeyPair>> | null = null;
let testJwk: jose.JWK | null = null;

export async function getTestKeyPair() {
  if (!testKeyPair) {
    testKeyPair = await jose.generateKeyPair('RS256', { extractable: true });
  }
  return testKeyPair;
}

export async function getTestJwk() {
  if (!testJwk) {
    const kp = await getTestKeyPair();
    testJwk = await jose.exportJWK(kp.publicKey);
    testJwk.kid = 'test-key-1';
    testJwk.alg = 'RS256';
    testJwk.use = 'sig';
  }
  return testJwk;
}

export interface TestTokenOptions {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  typ?: string;
  email?: string;
  preferred_username?: string;
  azp?: string;
  scope?: string;
  claims?: Record<string, unknown>;
  omit?: string[];
}

/**
 * Create a signed JWT for testing purposes.
 * Uses the test key pair (not Keycloak).
 */
export async function createTestToken(options: TestTokenOptions = {}): Promise<string> {
  const kp = await getTestKeyPair();

  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: options.sub ?? uuidv4(),
    iss: options.iss ?? 'http://localhost:8180/realms/iam-platform',
    aud: options.aud ?? 'iam-backend',
    exp: options.exp ?? now + 300,
    iat: now,
    nbf: now,
    typ: options.typ ?? 'Bearer',
    azp: options.azp || 'iam-backend',
    scope: options.scope || 'openid profile email',
    email: options.email,
    preferred_username: options.preferred_username,
    ...options.claims,
  };
  for (const claim of options.omit ?? []) delete payload[claim];

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .sign(kp.privateKey);

  return jwt;
}

/**
 * Create a token signed with a DIFFERENT key (to test invalid signature).
 */
export async function createTokenWithWrongKey(options: TestTokenOptions = {}): Promise<string> {
  const wrongKeyPair = await jose.generateKeyPair('RS256');
  const payload = jose.decodeJwt(await createTestToken(options));

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .sign(wrongKeyPair.privateKey);

  return jwt;
}

/**
 * Create an expired test token.
 */
export async function createExpiredToken(options: TestTokenOptions = {}): Promise<string> {
  return createTestToken({
    ...options,
    exp: Math.floor(Date.now() / 1000) - 60, // expired 1 minute ago
  });
}

// Seed data IDs for use in tests
export { SEED_IDS } from '../src/common/seed-ids.js';
