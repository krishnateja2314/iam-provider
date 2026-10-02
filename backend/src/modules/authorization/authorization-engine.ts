import { newEnforcer, newModelFromString, StringAdapter } from 'casbin';
import { getDb } from '../../db/connection.js';
import type { AuthorizationDecision, AuthorizationRequest } from '../../common/types.js';

const MODEL = `
[request_definition]
r = roles, obj, act
[policy_definition]
p = role, obj, act, eft
[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))
[matchers]
m = hasRole(r.roles, p.role) && r.obj == p.obj && r.act == p.act
`;

const BASE = [
  ['admin','learning-resource','read'], ['admin','learning-resource','list'],
  ['admin','learning-resource','create'], ['admin','learning-resource','update'],
  ['admin','member','manage'], ['admin','audit','read'], ['admin','policy','manage'],
  ['admin','submission','read'], ['admin','submission','list'], ['admin','submission','grade'],
  ['instructor','learning-resource','read'], ['instructor','learning-resource','list'],
  ['instructor','submission','read'], ['instructor','submission','list'], ['instructor','submission','grade'],
  ['learner','learning-resource','read'], ['learner','learning-resource','list'],
  ['learner','submission','read'], ['learner','submission','list'], ['learner','submission','submit'],
  ...['admin','instructor','learner'].flatMap(role => [['profile','read'],['consent','manage']].map(([obj,act])=>[role,obj,act])),
];

// Database facts and hard tenant/relationship denies precede the policy engine.
// A new enforcer reads tenant policy rows on each decision, without a stale cache.
export async function authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
  const deny = (reason: string, policy='boundary-deny'): AuthorizationDecision => ({allowed:false,reason,policy});
  try {
    const db = getDb();
    const membership = await db.selectFrom('memberships')
      .innerJoin('organizations','organizations.id','memberships.organization_id')
      .select(['memberships.id','memberships.status','organizations.status as orgStatus'])
      .where('memberships.user_id','=',request.subject.userId)
      .where('memberships.organization_id','=',request.organization).executeTakeFirst();
    if (!membership) return deny('User has no membership in this organization');
    if (membership.status !== 'active' || membership.orgStatus !== 'active') return deny('Membership or organization is not active');
    const rows = await db.selectFrom('membership_roles').innerJoin('roles','roles.id','membership_roles.role_id')
      .select('roles.name').where('membership_roles.membership_id','=',membership.id)
      .where('roles.organization_id','=',request.organization).execute();
    const roles = rows.map(row=>row.name);
    const resource = request.resource === 'course' ? 'learning-resource' : request.resource === 'member' || request.resource === 'user' ? 'member' : request.resource === 'assignment' ? 'submission' : request.resource;
    let courseId = request.resourceId;
    if (resource === 'learning-resource' && courseId) {
      const course = await db.selectFrom('learning_resources').select(['status','id'])
        .where('id','=',courseId).where('organization_id','=',request.organization).executeTakeFirst();
      if (!course) return deny('Resource not found in organization','tenant-scope');
      if (!roles.includes('admin') && course.status !== 'published') return deny('Unpublished resource denied');
    }
    if (resource === 'submission') {
      const submissionId = request.context?.submissionId;
      if (typeof submissionId === 'string') {
        const submission = await db.selectFrom('submissions').select(['course_id','user_id'])
          .where('id','=',submissionId).where('organization_id','=',request.organization).executeTakeFirst();
        if (!submission) return deny('Resource not found in organization','tenant-scope');
        courseId = submission.course_id;
        if (!roles.includes('admin') && !roles.includes('instructor') && submission.user_id !== request.subject.userId) return deny('Submission owner mismatch');
      }
      if (!roles.includes('admin') && roles.includes('instructor') && ['read','grade'].includes(request.action)) {
        if (!courseId) return deny('Resource ID required');
        const teaching = await db.selectFrom('teaching_assignments').select('id')
          .where('user_id','=',request.subject.userId).where('resource_id','=',courseId)
          .where('organization_id','=',request.organization).executeTakeFirst();
        if (!teaching) return deny('Instructor does not teach this course','teaching-relationship');
      }
      if (request.action === 'submit') {
        const course = courseId && await db.selectFrom('learning_resources').select('status')
          .where('id','=',courseId).where('organization_id','=',request.organization).executeTakeFirst();
        if (!course || course.status !== 'published') return deny('Published tenant course required');
      }
    }
    const policyRows = await db.selectFrom('policy_rules').select(['role_name','resource','action','effect'])
      .where('organization_id','=',request.organization).execute();
    const csv = BASE.map(([role,obj,act])=>`p, ${role}, ${obj}, ${act}, allow`)
      .concat(policyRows.map(row=>`p, ${row.role_name}, ${row.resource}, ${row.action}, ${row.effect}`)).join('\n');
    const enforcer = await newEnforcer(newModelFromString(MODEL),new StringAdapter(csv));
    enforcer.addFunction('hasRole',(value: unknown,role: unknown)=>Array.isArray(value) && value.includes(role));
    const allowed = await enforcer.enforce(roles,resource,request.action);
    return {allowed,reason:allowed?'Matching allow policy':'No matching allow policy or explicit deny',policy:'casbin-deny-overrides'};
  } catch {
    return deny('Authorization storage or evaluation unavailable','error-failclosed');
  }
}
