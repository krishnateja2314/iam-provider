// Add/update this lab's configuration in existing volumes without realm deletion.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = process.env.KEYCLOAK_BASE_URL || 'http://localhost:8180';
if (new URL(base).hostname !== 'localhost' || new URL(base).port !== '8180') throw new Error('Local synthetic provider only');
const root = fileURLToPath(new URL('../', import.meta.url));
const enableTests = process.argv.includes('--enable-test-client');
if (enableTests && process.env.IAM_ALLOW_PASSWORD_GRANT_TESTS !== 'true') throw new Error('Explicit IAM_ALLOW_PASSWORD_GRANT_TESTS=true required');

async function main() {
  const login = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli',
      username: process.env.KEYCLOAK_ADMIN || 'admin', password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin_dev_password' }),
  });
  if (!login.ok) throw new Error(`Bootstrap admin authentication failed (${login.status})`);
  const { access_token: token } = await login.json();
  async function api(path, method = 'GET', body, allow404 = false) {
    const result = await fetch(`${base}/admin${path}`, { method, signal: AbortSignal.timeout(15000), redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && result.status === 404) return undefined;
    if (!result.ok) throw new Error(`Configuration request failed (${method}, ${result.status}, ${path.split('?')[0]})`);
    if (result.status === 204 || result.headers.get('content-length') === '0') return;
    const text = await result.text();
    return text ? JSON.parse(text) : undefined;
  }
  for (const filename of ['iam-enterprise-realm.json', 'iam-platform-realm.json']) {
    const realm = JSON.parse(await readFile(resolve(root, 'infrastructure/keycloak', filename), 'utf8'));
    const prefix = `/realms/${realm.realm}`;
    let existing = await api(prefix, 'GET', undefined, true);
    if (!existing) {
      await api('/realms', 'POST', realm);
      existing = await api(prefix);
    }
    // Update only defined realm settings; leave unrelated users, keys and sessions intact.
    const { clients, users, clientScopes = [], clientScopeMappings, identityProviders = [], roles, ...settings } = realm;
    await api(prefix, 'PUT', settings);
    for (const role of roles?.realm || []) {
      if (!await api(`${prefix}/roles/${role.name}`, 'GET', undefined, true)) await api(`${prefix}/roles`, 'POST', role);
    }
    const scopes = await api(`${prefix}/client-scopes`);
    for (const scope of clientScopes) {
      const found = scopes.find(item => item.name === scope.name);
      if (found) {
        await api(`${prefix}/client-scopes/${found.id}`, 'PUT', { ...scope, protocolMappers: undefined });
        const mappers = await api(`${prefix}/client-scopes/${found.id}/protocol-mappers/models`);
        for (const mapper of scope.protocolMappers || []) {
          const old = mappers.find(item => item.name === mapper.name);
          await api(`${prefix}/client-scopes/${found.id}/protocol-mappers/models${old ? `/${old.id}` : ''}`, old ? 'PUT' : 'POST', { ...mapper, ...(old ? { id: old.id } : {}) });
        }
      } else await api(`${prefix}/client-scopes`, 'POST', scope);
    }
    const currentScopes = await api(`${prefix}/client-scopes`);
    for (const client of clients) {
      const old = (await api(`${prefix}/clients?clientId=${encodeURIComponent(client.clientId)}`))[0];
      const desired = { ...client, ...(client.clientId === 'iam-test' ? { enabled: enableTests } : {}) };
      if (old) await api(`${prefix}/clients/${old.id}`, 'PUT', { ...desired, id: old.id, protocolMappers: undefined });
      else await api(`${prefix}/clients`, 'POST', desired);
      const current = (await api(`${prefix}/clients?clientId=${encodeURIComponent(client.clientId)}`))[0];
      for (const name of client.defaultClientScopes || []) {
        const scope = currentScopes.find(item => item.name === name);
        if (!scope) throw new Error(`Required client scope missing: ${name}`);
        await api(`${prefix}/clients/${current.id}/default-client-scopes/${scope.id}`, 'PUT');
      }
      const mappers = await api(`${prefix}/clients/${current.id}/protocol-mappers/models`);
      for (const mapper of client.protocolMappers || []) {
        const oldMapper = mappers.find(item => item.name === mapper.name);
        await api(`${prefix}/clients/${current.id}/protocol-mappers/models${oldMapper ? `/${oldMapper.id}` : ''}`, oldMapper ? 'PUT' : 'POST', { ...mapper, ...(oldMapper ? { id: oldMapper.id } : {}) });
      }
    }
    for (const provider of identityProviders) {
      const old = await api(`${prefix}/identity-provider/instances/${provider.alias}`, 'GET', undefined, true);
      await api(`${prefix}/identity-provider/instances${old ? `/${provider.alias}` : ''}`, old ? 'PUT' : 'POST', provider);
    }
    for (const user of users) {
      if (user.serviceAccountClientId) continue;
      let old = (await api(`${prefix}/users?username=${encodeURIComponent(user.username)}&exact=true`))[0];
      if (old && old.id !== user.id) throw new Error('Fixture subject conflict; refusing identity reassignment');
      if (!old) {
        await api(`${prefix}/partialImport`, 'POST', { ifResourceExists: 'SKIP', users: [user] });
        old = (await api(`${prefix}/users?username=${encodeURIComponent(user.username)}&exact=true`))[0];
        if (old?.id !== user.id) throw new Error('Imported fixture subject mismatch; refusing identity reassignment');
      }
      for (const identity of user.federatedIdentities || []) {
        const links = await api(`${prefix}/users/${old.id}/federated-identity`);
        const link = links.find(item => item.identityProvider === identity.identityProvider);
        if (link && link.userId !== identity.userId) throw new Error('Enterprise link conflict; refusing reassignment');
        if (!link) await api(`${prefix}/users/${old.id}/federated-identity/${identity.identityProvider}`, 'POST', identity);
      }
      for (const name of user.realmRoles || []) {
        const role = await api(`${prefix}/roles/${name}`);
        await api(`${prefix}/users/${old.id}/role-mappings/realm`, 'POST', [role]);
      }
    }
    if (realm.realm === 'iam-platform') {
      // Enforce the fixture's explicit platform boundary, without touching other roles.
      const platformRole = await api(`${prefix}/roles/platform-admin`);
      for (const user of users.filter(item => item.id && item.username !== 'alice')) {
        await api(`${prefix}/users/${user.id}/role-mappings/realm`, 'DELETE', [platformRole]);
      }
      const adminClient = (await api(`${prefix}/clients?clientId=iam-provider-admin`))[0];
      const management = (await api(`${prefix}/clients?clientId=realm-management`))[0];
      const serviceUser = await api(`${prefix}/clients/${adminClient.id}/service-account-user`);
      const allowed = await Promise.all(['manage-users', 'view-users', 'query-users'].map(name => api(`${prefix}/clients/${management.id}/roles/${name}`)));
      const assigned = await api(`${prefix}/users/${serviceUser.id}/role-mappings/clients/${management.id}`);
      const excess = assigned.filter(role => !allowed.some(item => item.id === role.id));
      if (excess.length) await api(`${prefix}/users/${serviceUser.id}/role-mappings/clients/${management.id}`, 'DELETE', excess);
      const scoped = await api(`${prefix}/clients/${adminClient.id}/scope-mappings/clients/${management.id}`);
      const extraScopes = scoped.filter(role => !allowed.some(item => item.id === role.id));
      if (extraScopes.length) await api(`${prefix}/clients/${adminClient.id}/scope-mappings/clients/${management.id}`, 'DELETE', extraScopes);
      await api(`${prefix}/users/${serviceUser.id}/role-mappings/clients/${management.id}`, 'POST', allowed);
      await api(`${prefix}/clients/${adminClient.id}/scope-mappings/clients/${management.id}`, 'POST', allowed);
      const legacy = (await api(`${prefix}/clients?clientId=iam-frontend`))[0];
      if (legacy) await api(`${prefix}/clients/${legacy.id}`, 'PUT', { id: legacy.id, enabled: false });
    }
    console.log(`Configured ${realm.realm}; existing realm data preserved`);
  }
  console.log(`Local password-grant test client ${enableTests ? 'ENABLED (explicit opt-in)' : 'disabled'}`);
}
main().catch(error => {
  const known = /^(Bootstrap admin authentication failed|Configuration request failed|Required client scope missing|Fixture subject conflict|Imported fixture subject mismatch|Enterprise link conflict)/;
  console.error(known.test(error.message) ? error.message : 'Local provider configuration failed; no response bodies or credentials were logged');
  process.exitCode = 1;
});
