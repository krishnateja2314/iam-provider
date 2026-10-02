// Authentication Adapter Module
// Validates access tokens from Keycloak using JWKS (jose library).
// Does NOT accept ID tokens as API credentials.

import * as jose from 'jose';
import type { AuthenticatedUser } from '../../common/types.js';
import { AuthenticationError } from '../../common/types.js';
import { introspectAccessToken, providerSessionId } from './session-service.js';

let jwks: jose.JWTVerifyGetKey | null = null;

/**
 * Initialize JWKS key set from Keycloak.
 * Called once at startup.
 */
export function initJwks(issuerUrl: string, trustedJwks?: jose.JWTVerifyGetKey): void {
  const jwksUrl = new URL(process.env.JWKS_URL || `${issuerUrl.replace(/\/$/, '')}/protocol/openid-connect/certs`);
  jwks = trustedJwks ?? jose.createRemoteJWKSet(jwksUrl);
}

/**
 * Get the initialized JWKS. Throws if not initialized.
 */
function getJwks(): jose.JWTVerifyGetKey {
  if (!jwks) {
    throw new AuthenticationError('JWKS not initialized');
  }
  return jwks;
}

/**
 * Token validation options.
 */
export interface TokenValidationOptions {
  issuer: string;
  audience: string;
  authorizedParties?: string[];
}

/**
 * Validate an access token.
 * 
 * Checks:
 * 1. Signature (via JWKS)
 * 2. Issuer must match expected Keycloak realm
 * 3. Audience must include our backend client ID
 * 4. Expiration (must not be expired)
 * 5. Token type must be Bearer (not ID token)
 * 6. Subject must be present
 */
export async function validateAccessToken(
  token: string,
  options: TokenValidationOptions
): Promise<jose.JWTPayload> {
  const keySet = getJwks();

  try {
    const { payload } = await jose.jwtVerify(token, keySet, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'iss', 'aud'],
      clockTolerance: 0,
    });

    // Reject ID tokens used as API credentials
    // Keycloak ID tokens have typ="ID" while access tokens have typ="Bearer"
    if (payload.typ !== 'Bearer') {
      throw new AuthenticationError(
        'Token type must be Bearer; ID tokens cannot be used as API credentials'
      );
    }

    // Ensure subject claim exists
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      throw new AuthenticationError('Token missing subject claim');
    }
    if (!(typeof payload.aud === 'string' && payload.aud.trim()) &&
        !(Array.isArray(payload.aud) && payload.aud.length > 0 && payload.aud.every(value => typeof value === 'string' && value.trim()))) {
      throw new AuthenticationError('Invalid token claim: aud');
    }

    if (payload.iat !== undefined && (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000 + 5 || payload.iat >= payload.exp!)) {
      throw new AuthenticationError('Invalid issued-at claim');
    }
    for (const claim of ['email', 'preferred_username', 'name', 'azp', 'scope', 'sid', 'session_state', 'identity_provider', 'identity_provider_identity', 'broker_session_id', 'broker_user_id', 'idp']) {
      if (payload[claim] !== undefined && (typeof payload[claim] !== 'string' || !String(payload[claim]).trim())) {
        throw new AuthenticationError(`Invalid token claim: ${claim}`);
      }
    }
    if (payload.email_verified !== undefined && typeof payload.email_verified !== 'boolean') {
      throw new AuthenticationError('Invalid token claim: email_verified');
    }
    const validRoleSet = (value: unknown): boolean => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const roles = (value as Record<string, unknown>).roles;
      return roles === undefined || (Array.isArray(roles) && roles.every(role => typeof role === 'string' && role.trim()));
    };
    if (payload.realm_access !== undefined && !validRoleSet(payload.realm_access)) {
      throw new AuthenticationError('Invalid token claim: realm_access');
    }
    if (payload.resource_access !== undefined && (!payload.resource_access || typeof payload.resource_access !== 'object' || Array.isArray(payload.resource_access) || !Object.values(payload.resource_access).every(validRoleSet))) {
      throw new AuthenticationError('Invalid token claim: resource_access');
    }
    const allowed = options.authorizedParties ?? (process.env.KEYCLOAK_ALLOWED_AZP?.trim() ? process.env.KEYCLOAK_ALLOWED_AZP.split(',').map(value => value.trim()).filter(Boolean) : undefined);
    if (allowed && (typeof payload.azp !== 'string' || !allowed.includes(payload.azp))) {
      throw new AuthenticationError('Token authorized party mismatch');
    }
    providerSessionId(payload);
    if (process.env.KEYCLOAK_INTROSPECTION === 'true') {
      await introspectAccessToken(token, payload);
    }

    return payload;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    if (error instanceof jose.errors.JWTExpired) {
      throw new AuthenticationError('Access token has expired');
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      const claimError = error as jose.errors.JWTClaimValidationFailed;
      if (claimError.claim === 'iss') {
        throw new AuthenticationError('Token issuer mismatch');
      }
      if (claimError.claim === 'aud') {
        throw new AuthenticationError('Token audience mismatch');
      }
      throw new AuthenticationError(`Token claim validation failed: ${claimError.claim}`);
    }
    if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      throw new AuthenticationError('Invalid token signature');
    }
    throw new AuthenticationError('Token validation failed');
  }
}

/**
 * Extract the Bearer token from an Authorization header.
 */
export function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new AuthenticationError('Missing Authorization header');
  }
  if (!authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Authorization header must use Bearer scheme');
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AuthenticationError('Empty Bearer token');
  }
  return token;
}

/**
 * Build an AuthenticatedUser from validated token claims.
 */
export function buildAuthenticatedUser(payload: jose.JWTPayload): AuthenticatedUser {
  return {
    userId: '', // Will be resolved by user lookup
    keycloakSub: payload.sub!,
    email: (payload as Record<string, unknown>).email as string | undefined,
    issuer: payload.iss!,
    providerSessionId: providerSessionId(payload),
    platformAdmin: ((payload.realm_access as { roles?: string[] } | undefined)?.roles ?? []).includes('platform-admin'),
  };
}
