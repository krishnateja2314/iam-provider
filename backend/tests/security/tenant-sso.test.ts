// M5: per-tenant domain/SSO association.
// DB part: real PostgreSQL. Live part: real Keycloak, gated by RUN_KEYCLOAK_TESTS=1.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, closeDb } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { discoverSso, provisionOrganization, setOrganizationStatus, getTenantSso } from '../../src/modules/provisioning/provisioning-service.js';

const prefix = `sso-${randomUUID().slice(0, 8)}`;
const domain = (suffix: string) => `${suffix}.${prefix}.example`;
const admin = randomUUID();
const db = getDb();
const request = (suffix: string, extra: Record<string, unknown> = {}) => ({
  actorUserId: admin, correlationId: randomUUID(), name: `SSO fixture ${suffix}`, slug: `${prefix}-${suffix}`,
  adminUserId: admin, idempotencyKey: `${prefix}-${suffix}`, ...extra,
});

beforeAll(async () => {
  await migrate();
  await db.insertInto('users').values({ id: admin, display_name: 'Synthetic SSO admin' }).execute();
});
afterAll(async () => {
  await db.deleteFrom('organizations').where('slug', 'like', `${prefix}%`).execute();
  await db.deleteFrom('audit_events').where('actor_id', '=', admin).execute();
  await db.deleteFrom('users').where('id', '=', admin).execute();
  await closeDb();
});

describe('tenant domain/SSO association in provisioning (real PostgreSQL)', () => {
  it('persists the association atomically with the tenant and audits it', async () => {
    const result = await provisionOrganization(request('a', { sso: { emailDomain: domain('A').toUpperCase(), identityProviderAlias: 'enterprise' } }));
    expect(await getTenantSso(result.organizationId)).toEqual([{ emailDomain: domain('a'), identityProviderAlias: 'enterprise' }]);
    const audit = await db.selectFrom('audit_events').select('action').where('organization_id', '=', result.organizationId).execute();
    expect(audit.map(a => a.action)).toEqual(expect.arrayContaining(['organization.provision', 'organization.sso.configure']));
    expect(await discoverSso(`someone@${domain('a')}`)).toEqual({ emailDomain: domain('a'), identityProviderAlias: 'enterprise' });
  });

  it('idempotent retry returns the same tenant; a changed SSO payload under the same key conflicts', async () => {
    const input = request('b', { sso: { emailDomain: domain('b'), identityProviderAlias: 'enterprise' } });
    const first = await provisionOrganization(input);
    expect((await provisionOrganization({ ...input, correlationId: randomUUID() })).organizationId).toBe(first.organizationId);
    await expect(provisionOrganization({ ...input, sso: { emailDomain: domain('b2'), identityProviderAlias: 'enterprise' } }))
      .rejects.toMatchObject({ code: 'conflict' });
  });

  it('a domain already owned by another tenant rolls back the whole provisioning (no partial tenant)', async () => {
    await expect(provisionOrganization(request('c', { sso: { emailDomain: domain('a'), identityProviderAlias: 'enterprise' } })))
      .rejects.toMatchObject({ code: '23505' });
    expect(await db.selectFrom('organizations').select('id').where('slug', '=', `${prefix}-c`).execute()).toHaveLength(0);
    expect(await db.selectFrom('provisioning_requests').select('organization_id').where('idempotency_key', '=', `${prefix}-c`).execute()).toHaveLength(0);
  });

  it.each([
    ['unknown broker alias', { emailDomain: 'x.example', identityProviderAlias: 'not-configured' }],
    ['malformed domain', { emailDomain: 'not a domain', identityProviderAlias: 'enterprise' }],
  ])('rejects %s before writing anything', async (_label, sso) => {
    await expect(provisionOrganization(request('d', { sso }))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await db.selectFrom('organizations').select('id').where('slug', '=', `${prefix}-d`).execute()).toHaveLength(0);
  });

  it('a suspended tenant is not offered for discovery; reactivation restores it', async () => {
    const result = await provisionOrganization(request('e', { sso: { emailDomain: domain('e'), identityProviderAlias: 'enterprise' } }));
    await setOrganizationStatus({ actorUserId: admin, correlationId: randomUUID(), organizationId: result.organizationId, status: 'suspended', platformAuthorized: true });
    expect(await discoverSso(`u@${domain('e')}`)).toBeUndefined();
    await setOrganizationStatus({ actorUserId: admin, correlationId: randomUUID(), organizationId: result.organizationId, status: 'active', platformAuthorized: true });
    expect(await discoverSso(`u@${domain('e')}`)).toBeDefined();
  });

  it('discovery returns nothing for unknown or malformed emails', async () => {
    expect(await discoverSso(`u@unknown.${prefix}.example`)).toBeUndefined();
    expect(await discoverSso('no-at-sign')).toBeUndefined();
    expect(await discoverSso('@')).toBeUndefined();
  });
});

describe.skipIf(process.env.RUN_KEYCLOAK_TESTS !== '1')('Live Keycloak: newly provisioned tenant routes to its configured enterprise broker', () => {
  const issuer = process.env.JWT_ISSUER || 'http://localhost:8180/realms/iam-platform';
  const internal = (href: string) => {
    const url = new URL(href);
    if (process.env.KEYCLOAK_INTERNAL_URL) { const i = new URL(process.env.KEYCLOAK_INTERNAL_URL); url.protocol = i.protocol; url.host = i.host; }
    return url;
  };
  async function followAuthorization(hint?: string): Promise<{ status: number; location?: URL }[]> {
    const auth = internal(`${issuer}/protocol/openid-connect/auth`);
    auth.search = new URLSearchParams({ client_id: 'iam-web', redirect_uri: 'http://localhost:5173/web.html', response_type: 'code',
      scope: 'openid', state: randomUUID(), nonce: randomUUID(), code_challenge_method: 'S256',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', ...(hint ? { kc_idp_hint: hint } : {}) }).toString();
    const hops: { status: number; location?: URL }[] = [];
    const cookies: string[] = [];
    let next: URL | undefined = auth;
    for (let hop = 0; next && hop < 4; hop++) {
      const response: Response = await fetch(next, { redirect: 'manual', headers: { cookie: cookies.join('; ') }, signal: AbortSignal.timeout(5000) });
      cookies.push(...response.headers.getSetCookie().map(c => c.split(';')[0]));
      const location = response.headers.get('location') ? new URL(response.headers.get('location')!) : undefined;
      hops.push({ status: response.status, location });
      if (!location || location.pathname.includes('/realms/iam-enterprise/')) break;
      next = internal(location.href);
    }
    return hops;
  }

  it('discovery for the new tenant domain yields a hint that Keycloak brokers to the enterprise realm', async () => {
    const result = await provisionOrganization(request('live', { sso: { emailDomain: domain('live'), identityProviderAlias: 'enterprise' } }));
    expect(result.organizationId).toBeTruthy();
    const found = await discoverSso(`new.user@${domain('live')}`);
    expect(found?.identityProviderAlias).toBe('enterprise');
    const hops = await followAuthorization(found!.identityProviderAlias);
    const last = hops.at(-1)!;
    expect(last.location?.pathname).toBe('/realms/iam-enterprise/protocol/openid-connect/auth');
    expect(last.location?.searchParams.get('client_id')).toBe('iam-enterprise-broker');
  });

  it('control: without the hint the platform login page is served (no broker redirect)', async () => {
    const hops = await followAuthorization();
    expect(hops).toHaveLength(1);
    expect(hops[0].status).toBe(200);
  });

  it('control: an alias that is not configured in Keycloak does not reach the enterprise realm', async () => {
    const hops = await followAuthorization('not-configured');
    expect(hops.some(h => h.location?.pathname.includes('/realms/iam-enterprise/'))).toBe(false);
  });
});
