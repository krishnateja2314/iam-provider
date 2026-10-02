import { getDb } from '../../db/connection.js';
import { auditMutation, lockOrganization, ProvisioningError, type MutationContext } from '../provisioning/provisioning-service.js';

export type ConsentPurpose = 'profile-sharing' | 'analytics';

export async function recordConsent(input: MutationContext & {
  organizationId: string; purpose: ConsentPurpose; granted: boolean;
}) {
  if (!['profile-sharing', 'analytics'].includes(input.purpose) || typeof input.granted !== 'boolean') {
    throw new ProvisioningError('invalid_input', 'Unsupported consent purpose');
  }
  return getDb().transaction().execute(async trx => {
    const org = await lockOrganization(trx, input.organizationId);
    const member = await trx.selectFrom('memberships').select(['id', 'status']).where('user_id', '=', input.actorUserId)
      .where('organization_id', '=', org.id).executeTakeFirst();
    // Suspension must never prevent a member from withdrawing their own consent.
    if (!member || (input.granted && (member.status !== 'active' || org.status !== 'active'))) {
      throw new ProvisioningError('forbidden', 'Active membership required to grant consent');
    }
    const consent = await trx.insertInto('consents').values({ user_id: input.actorUserId,
      organization_id: org.id, purpose: input.purpose, granted: input.granted,
      revoked_at: input.granted ? null : new Date(), ip_address: null }).returning('id').executeTakeFirstOrThrow();
    await auditMutation(trx, input, org.id, input.granted ? 'consent.grant' : 'consent.withdraw', 'consent', consent.id, input.actorUserId);
    return { consentId: consent.id };
  });
}

export async function getSharedProfile(input: { actorUserId: string; userId: string; organizationId: string;
  fields?: readonly string[] }) {
  // A repeatable snapshot avoids combining a pre-withdrawal grant with post-withdrawal data.
  return getDb().transaction().setIsolationLevel('repeatable read').execute(async trx => {
    const org = await trx.selectFrom('organizations').select('status').where('id', '=', input.organizationId).executeTakeFirst();
    if (org?.status !== 'active') throw new ProvisioningError('forbidden', 'Active organization required');
    const members = await trx.selectFrom('memberships').select('user_id').where('organization_id', '=', input.organizationId)
      .where('user_id', 'in', [input.actorUserId, input.userId]).where('status', '=', 'active').execute();
    if (!members.some(m => m.user_id === input.actorUserId) || !members.some(m => m.user_id === input.userId)) {
      throw new ProvisioningError('forbidden', 'Active organization membership required');
    }
    const profile = await trx.selectFrom('profiles').select(['display_name', 'bio']).where('user_id', '=', input.userId)
      .where('organization_id', '=', input.organizationId).executeTakeFirst();
    if (!profile) throw new ProvisioningError('not_found', 'Profile not found');
    const consent = await trx.selectFrom('consents').select(['granted', 'revoked_at']).where('user_id', '=', input.userId)
      .where('organization_id', '=', input.organizationId).where('purpose', '=', 'profile-sharing')
      .orderBy('sequence', 'desc').executeTakeFirst();
    const requested = new Set(input.fields ?? ['userId', 'displayName']);
    const result: { userId?: string; displayName?: string; bio?: string | null } = {};
    if (requested.has('userId')) result.userId = input.userId;
    if (requested.has('displayName')) result.displayName = profile.display_name;
    if (requested.has('bio') && consent?.granted && !consent.revoked_at) result.bio = profile.bio;
    return result;
  });
}
