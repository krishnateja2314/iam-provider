import type { JWTPayload } from 'jose';
import { AuthenticationError, AuthorizationError } from '../../common/types.js';

export function providerSessionId(claims: JWTPayload): string | undefined {
  const { sid, session_state: state } = claims;
  if ((sid !== undefined && (typeof sid !== 'string' || !sid.trim())) ||
      (state !== undefined && (typeof state !== 'string' || !state.trim())) ||
      (sid !== undefined && state !== undefined && sid !== state)) {
    throw new AuthenticationError('Invalid provider session claims');
  }
  return (sid ?? state) as string | undefined;
}

function realmUrl(issuer = process.env.JWT_ISSUER): URL {
  if (!issuer) throw new Error('JWT_ISSUER is not configured');
  const url = new URL(issuer);
  if (process.env.KEYCLOAK_INTERNAL_URL) {
    const internal = new URL(process.env.KEYCLOAK_INTERNAL_URL);
    url.protocol = internal.protocol;
    url.host = internal.host;
  }
  return url;
}

async function providerFetch(url: URL, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('Provider request failed');
    return response;
  } catch {
    throw new AuthenticationError('Provider session verification unavailable');
  }
}

function credentials(admin = false): { client_id: string; client_secret: string } {
  const secret = admin ? process.env.KEYCLOAK_ADMIN_CLIENT_SECRET : process.env.KEYCLOAK_CLIENT_SECRET;
  if (!secret) throw new AuthenticationError('Provider client credentials not configured');
  return { client_id: (admin ? process.env.KEYCLOAK_ADMIN_CLIENT_ID : process.env.KEYCLOAK_CLIENT_ID) || (admin ? 'iam-provider-admin' : 'iam-backend'), client_secret: secret };
}

/** No cache: every configured API authentication asks the provider about current state. */
export async function introspectAccessToken(token: string, verifiedClaims: JWTPayload): Promise<void> {
  const url = realmUrl(verifiedClaims.iss);
  url.pathname += '/protocol/openid-connect/token/introspect';
  const response = await providerFetch(url, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...credentials(), token, token_type_hint: 'access_token' }),
  });
  let claims: JWTPayload;
  try { claims = await response.json() as JWTPayload; } catch { throw new AuthenticationError('Malformed provider introspection'); }
  const expectedSession = providerSessionId(verifiedClaims);
  if (!claims || claims.active !== true || claims.sub !== verifiedClaims.sub || !expectedSession || providerSessionId(claims) !== expectedSession) {
    throw new AuthenticationError('Provider session is inactive or does not match token');
  }
}

export interface ProviderSession {
  id: string;
  start?: number;
  lastAccess?: number;
  ipAddress?: string;
  clients?: Record<string, string>;
}

async function adminRequest(path: string, method = 'GET'): Promise<Response> {
  const realm = realmUrl();
  const tokenUrl = new URL(`${realm.href}/protocol/openid-connect/token`);
  const response = await providerFetch(tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...credentials(true), grant_type: 'client_credentials' }),
  });
  const token = await response.json() as { access_token?: unknown };
  if (typeof token.access_token !== 'string') throw new AuthenticationError('Provider admin authentication failed');
  realm.pathname = realm.pathname.replace('/realms/', '/admin/realms/') + path;
  return providerFetch(realm, { method, headers: { authorization: `Bearer ${token.access_token}` } });
}

export async function listProviderSessions(subject: string): Promise<ProviderSession[]> {
  const response = await adminRequest(`/users/${encodeURIComponent(subject)}/sessions`);
  const sessions: unknown = await response.json();
  if (!Array.isArray(sessions) || sessions.some(value => !value || typeof value.id !== 'string' || !value.id.trim())) {
    throw new AuthenticationError('Malformed provider session response');
  }
  return sessions.map(session => ({
    id: session.id,
    start: typeof session.start === 'number' ? session.start : undefined,
    lastAccess: typeof session.lastAccess === 'number' ? session.lastAccess : undefined,
    ipAddress: typeof session.ipAddress === 'string' ? session.ipAddress : undefined,
    clients: session.clients && typeof session.clients === 'object' && !Array.isArray(session.clients) && Object.values(session.clients).every(value => typeof value === 'string') ? session.clients : undefined,
  }));
}

export async function revokeProviderSession(subject: string, sessionId: string): Promise<void> {
  const sessions = await listProviderSessions(subject);
  if (!sessions.some(session => session.id === sessionId)) throw new AuthorizationError('Session does not belong to user');
  await adminRequest(`/sessions/${encodeURIComponent(sessionId)}`, 'DELETE');
}

/** Caller must authorize an administrative reset, or supply its own authenticated subject. */
export async function resetProviderSessions(subject: string): Promise<void> {
  await adminRequest(`/users/${encodeURIComponent(subject)}/logout`, 'POST');
}
