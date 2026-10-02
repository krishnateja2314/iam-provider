import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../src/modules/authorization/authorization-engine.js';
import { getDb,closeDb } from '../../src/db/connection.js';
import { SEED_IDS as id } from '../../src/common/seed-ids.js';

const org=id.ORG_ACME;
const people=[['admin',id.USER_ALICE],['instructor',id.USER_BOB],['learner',id.USER_CHARLIE]] as const;
const permissions=[
  ['learning-resource','read',['admin','instructor','learner']],
  ['learning-resource','list',['admin','instructor','learner']],
  ['learning-resource','create',['admin']],
  ['learning-resource','update',['admin']],
  ['learning-resource','delete',[]],
  ['member','manage',['admin']],['member','read',[]],['member','delete',[]],
  ['audit','read',['admin']],['audit','list',[]],
  ['policy','manage',['admin']],['policy','read',[]],
  ['submission','grade',['admin','instructor']],
  ['submission','submit',['learner']],
  ['profile','read',['admin','instructor','learner']],
  ['consent','manage',['admin','instructor','learner']],
] as const;
afterAll(closeDb);
describe('T13: 48 declarative role/resource/action cases',()=>{
  for(const [role,userId] of people)for(const [resource,action,allowed]of permissions){
    it(`${role} ${action} ${resource} => ${(allowed as readonly string[]).includes(role)?'allow':'deny'}`,async()=>{
      const decision=await authorize({subject:{userId,keycloakSub:'synthetic-test',issuer:'http://localhost:8180/realms/iam-platform'},organization:org,resource,action,resourceId:resource==='submission'?id.RES_ACME_COURSE1:undefined});
      expect(decision.allowed).toBe((allowed as readonly string[]).includes(role));
    });
  }
});
describe('T05-T08: hard tenant and relationship boundaries',()=>{
  const check=(userId:string,organization:string,resource:string,action:string,resourceId?:string,context?:Record<string,unknown>)=>authorize({subject:{userId,keycloakSub:'test',issuer:'http://localhost:8180/realms/iam-platform'},organization,resource,action,resourceId,context});
  it('same global user is admin in Acme but learner in Globex',async()=>{
    expect((await check(id.USER_ALICE,org,'member','manage')).allowed).toBe(true);
    expect((await check(id.USER_ALICE,id.ORG_GLOBEX,'member','manage')).allowed).toBe(false);
  });
  it('tenant selector cannot grant nonmember access',async()=>expect((await check(id.USER_CHARLIE,id.ORG_GLOBEX,'learning-resource','read',id.RES_GLOBEX_COURSE1)).allowed).toBe(false));
  it('resource ID cannot cross tenant even for admin',async()=>expect((await check(id.USER_ALICE,org,'learning-resource','read',id.RES_GLOBEX_COURSE1)).allowed).toBe(false));
  it('learner cannot read unpublished course',async()=>expect((await check(id.USER_CHARLIE,org,'learning-resource','read','50000000-0000-0000-0000-000000000005')).allowed).toBe(false));
  it('instructor cannot grade unassigned course',async()=>expect((await check(id.USER_BOB,org,'submission','grade',id.RES_ACME_COURSE2)).allowed).toBe(false));
  it('instructor can grade assigned submission',async()=>expect((await check(id.USER_BOB,org,'submission','grade',undefined,{submissionId:'80000000-0000-0000-0000-000000000001'})).allowed).toBe(true));
  it('instructor cannot read unrelated submission',async()=>expect((await check(id.USER_BOB,org,'submission','read',undefined,{submissionId:'80000000-0000-0000-0000-000000000002'})).allowed).toBe(false));
  it('inactive membership always denied',async()=>expect((await check(id.USER_EVE,org,'learning-resource','list')).allowed).toBe(false));
  it('explicit deny overrides an admin allow and policy changes take effect next decision',async()=>{
    const rule=randomUUID();
    try{
      expect((await check(id.USER_ALICE,org,'learning-resource','list')).allowed).toBe(true);
      await getDb().insertInto('policy_rules').values({id:rule,organization_id:org,role_name:'admin',resource:'learning-resource',action:'list',effect:'deny'}).execute();
      expect((await check(id.USER_ALICE,org,'learning-resource','list')).allowed).toBe(false);
    }finally{await getDb().deleteFrom('policy_rules').where('id','=',rule).execute();}
    expect((await check(id.USER_ALICE,org,'learning-resource','list')).allowed).toBe(true);
  });
  it('removing a role denies the subsequent decision',async()=>{
    const assignments=await getDb().selectFrom('membership_roles').selectAll().where('membership_id','=',id.MEM_ALICE_ACME).execute();
    try{
      await getDb().deleteFrom('membership_roles').where('membership_id','=',id.MEM_ALICE_ACME).execute();
      expect((await check(id.USER_ALICE,org,'member','manage')).allowed).toBe(false);
    }finally{if(assignments.length)await getDb().insertInto('membership_roles').values(assignments).execute();}
  });
  it('explicit deny on one role wins over an allow on another role',async()=>{
    const rule=randomUUID(),assignment=randomUUID();
    try{
      await getDb().insertInto('membership_roles').values({id:assignment,membership_id:id.MEM_BOB_ACME,role_id:id.ROLE_ACME_ADMIN,organization_id:org}).execute();
      await getDb().insertInto('policy_rules').values({id:rule,organization_id:org,role_name:'instructor',resource:'learning-resource',action:'list',effect:'deny'}).execute();
      expect((await check(id.USER_BOB,org,'learning-resource','list')).allowed).toBe(false);
    }finally{
      await getDb().deleteFrom('policy_rules').where('id','=',rule).execute();
      await getDb().deleteFrom('membership_roles').where('id','=',assignment).execute();
    }
  });
});
