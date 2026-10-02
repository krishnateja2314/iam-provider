// User & Profile Management Module
// Resolves Keycloak identity to platform user.
// Creates or links authentication identities.

import { getDb } from '../../db/connection.js';
import { sql } from 'kysely';

/**
 * Find a platform user by their external identity (issuer + subject).
 * Does NOT merge by email - uses issuer+subject as the identity key.
 */
export async function findUserByExternalIdentity(
  issuer: string,
  subject: string
): Promise<{ userId: string; displayName: string } | null> {
  const db = getDb();
  const result = await db
    .selectFrom('authentication_identities')
    .innerJoin('users', 'users.id', 'authentication_identities.user_id')
    .select(['users.id as userId', 'users.display_name as displayName'])
    .where('authentication_identities.issuer', '=', issuer)
    .where('authentication_identities.subject', '=', subject)
    .executeTakeFirst();

  return result ? { userId: result.userId, displayName: result.displayName } : null;
}

/**
 * Find a platform user by their internal ID.
 */
export async function findUserById(
  userId: string
): Promise<{ userId: string; displayName: string } | null> {
  const db = getDb();
  const result = await db
    .selectFrom('users')
    .select(['id as userId', 'display_name as displayName'])
    .where('id', '=', userId)
    .executeTakeFirst();

  return result ? { userId: result.userId, displayName: result.displayName } : null;
}

/**
 * Create or link a user from an external identity.
 * If the issuer+subject already exist, return the existing user.
 * If not, create a new user and link the identity.
 */
export async function findOrCreateUser(
  issuer: string,
  subject: string,
  email: string | undefined,
  displayName: string,
  emailVerified: boolean = false
): Promise<{ userId: string; created: boolean }> {
  const db = getDb();

  const result = await db.transaction().execute(async (trx) => {
    // Serialize lookup and creation for this identity across backend instances.
    await sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([issuer, subject])}, 0))`.execute(trx);
    const existing = await trx.selectFrom('authentication_identities').select('user_id')
      .where('issuer', '=', issuer).where('subject', '=', subject).executeTakeFirst();
    if (existing) return { userId: existing.user_id, created: false };
    const user = await trx
      .insertInto('users')
      .values({ display_name: displayName })
      .returning('id')
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('authentication_identities')
      .values({
        user_id: user.id,
        issuer,
        subject,
        email: email ?? null,
        email_verified: emailVerified === true,
      })
      .execute();

    return { userId: user.id, created: true };
  });

  return result;
}

/**
 * Check if a duplicate external identity exists (for testing constraint).
 */
export async function externalIdentityExists(
  issuer: string,
  subject: string
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .selectFrom('authentication_identities')
    .select('id')
    .where('issuer', '=', issuer)
    .where('subject', '=', subject)
    .executeTakeFirst();

  return !!result;
}
