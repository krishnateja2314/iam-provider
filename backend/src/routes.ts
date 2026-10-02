import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getDb } from './db/connection.js';
import { authorize } from './modules/authorization/authorization-engine.js';
import { recordAuditEvent, queryAuditEvents } from './modules/audit/audit-service.js';
import { listUserOrganizations } from './modules/organization/membership-service.js';
import { authenticationHook, tenantContextHook, auditRequest, UUID_PATTERN, isUuid } from './middleware.js';
import { provisionOrganization, setOrganizationStatus, createMember, ProvisioningError, lockOrganization } from './modules/provisioning/provisioning-service.js';
import { getSharedProfile, recordConsent } from './modules/user/privacy-service.js';
import { listProviderSessions, revokeProviderSession, resetProviderSessions } from './modules/auth/session-service.js';

const tenantHooks = [authenticationHook,tenantContextHook];
const uuid = {type:'string',pattern:UUID_PATTERN};
const idParams = (key:string) => ({type:'object',required:[key],additionalProperties:false,properties:{[key]:uuid}});

async function permit(request:FastifyRequest,reply:FastifyReply,resource:string,action:string,resourceId?:string,context?:Record<string,unknown>):Promise<boolean> {
  const decision = await authorize({subject:request.auth!,organization:request.tenant!.organizationId,resource,action,resourceId,context});
  if (!decision.allowed) {
    await auditRequest(request,`${resource}.${action}`,'deny',decision.reason,resource,resourceId??null);
    const status = decision.policy==='error-failclosed'?503:decision.policy==='tenant-scope'?404:403;
    reply.code(status).send({error:status===404?'Resource not found':status===503?'Authorization unavailable':'Access denied',code:'AUTHORIZATION_DENIED'});
  }
  return decision.allowed;
}

export function registerRoutes(app:FastifyInstance):void {
  app.get('/health',async()=>({status:'ok',service:'iam-platform'}));
  app.get('/ready',async()=> {await sql`SELECT 1`.execute(getDb());return {status:'ready'};});
  for (const path of ['/api/v1/me','/api/v1/organizations']) app.get(path,{preHandler:[authenticationHook]},async request=>{
    const organizations=await listUserOrganizations(request.auth!.userId);
    await auditRequest(request,'identity.read','allow','Authenticated caller');
    return {userId:request.auth!.userId,organizations};
  });
  app.get('/api/v1/resources',{preHandler:tenantHooks,schema:{querystring:{type:'object',additionalProperties:false,properties:{status:{type:'string',enum:['published','draft','archived']},type:{type:'string',enum:['course','module','lesson','assignment']}}}}},async(request,reply)=>{
    if (!await permit(request,reply,'learning-resource','list')) return;
    const query=request.query as {status?:'published'|'draft'|'archived';type?:'course'|'module'|'lesson'|'assignment'};
    const admin=request.tenant!.roles.includes('admin');
    if(!admin && query.status && query.status!=='published') {
      await auditRequest(request,'resource.list','deny','Unpublished resource list denied');
      return reply.code(403).send({error:'Access denied'});
    }
    let q=getDb().selectFrom('learning_resources').selectAll().where('organization_id','=',request.tenant!.organizationId).where('status','=',query.status??'published');
    if(query.type)q=q.where('resource_type','=',query.type);
    const resources=await q.orderBy('id').limit(100).execute();
    await auditRequest(request,'resource.list','allow','Tenant-filtered list');
    return {resources,organizationId:request.tenant!.organizationId};
  });
  app.get('/api/v1/resources/:resourceId',{preHandler:tenantHooks,schema:{params:idParams('resourceId')}},async(request,reply)=>{
    const {resourceId}=request.params as {resourceId:string};
    if (!await permit(request,reply,'learning-resource','read',resourceId))return;
    const resource=await getDb().selectFrom('learning_resources').selectAll().where('id','=',resourceId).where('organization_id','=',request.tenant!.organizationId).executeTakeFirst();
    await auditRequest(request,'resource.read','allow','Tenant-bound resource read','learning-resource',resourceId);
    return {resource};
  });
  app.get('/api/v1/members',{preHandler:tenantHooks},async(request,reply)=>{
    if(!await permit(request,reply,'member','manage'))return;
    const members=await getDb().selectFrom('memberships').innerJoin('users','users.id','memberships.user_id')
      .select(['memberships.id as membershipId','users.id as userId','users.display_name as displayName','memberships.status'])
      .where('memberships.organization_id','=',request.tenant!.organizationId).execute();
    await auditRequest(request,'member.manage','allow','Tenant admin');return {members};
  });
  app.get('/api/v1/audit-events',{preHandler:tenantHooks,schema:{querystring:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:100},decision:{type:'string',enum:['allow','deny','error']},action:{type:'string',maxLength:100}}}}},async(request,reply)=>{
    if(!await permit(request,reply,'audit','read'))return;
    const query=request.query as {limit?:number;decision?:'allow'|'deny'|'error';action?:string};
    await auditRequest(request,'audit.read','allow','Tenant admin audit access');
    return {events:await queryAuditEvents({...query,organizationId:request.tenant!.organizationId})};
  });
  app.get('/api/v1/submissions',{preHandler:tenantHooks},async(request,reply)=>{
    if(!await permit(request,reply,'submission','list'))return;
    let q=getDb().selectFrom('submissions').selectAll().where('organization_id','=',request.tenant!.organizationId);
    if(!request.tenant!.roles.includes('admin')) {
      if(request.tenant!.roles.includes('instructor'))q=q.where('course_id','in',getDb().selectFrom('teaching_assignments').select('resource_id').where('organization_id','=',request.tenant!.organizationId).where('user_id','=',request.auth!.userId));
      else q=q.where('user_id','=',request.auth!.userId);
    }
    const submissions=await q.limit(100).execute();await auditRequest(request,'submission.list','allow','Owner or teaching filtered');return {submissions};
  });
  app.post('/api/v1/resources',{preHandler:tenantHooks,schema:{body:{type:'object',additionalProperties:false,required:['title'],properties:{title:{type:'string',minLength:1,maxLength:500},status:{type:'string',enum:['published','draft','archived']}}}}},async(request,reply)=>{
    if(!await permit(request,reply,'learning-resource','create'))return;
    return getDb().transaction().execute(async trx=>{
      const org=await lockOrganization(trx,request.tenant!.organizationId);
      if(org.status!=='active')throw new ProvisioningError('forbidden','Organization inactive');
      const body=request.body as {title:string;status?:'published'|'draft'|'archived'};
      const resource=await trx.insertInto('learning_resources').values({organization_id:org.id,title:body.title,description:null,resource_type:'course',status:body.status??'draft',created_by:request.auth!.userId}).returningAll().executeTakeFirstOrThrow();
      await recordAuditEvent({actorId:request.auth!.userId,actorType:'user',organizationId:org.id,action:'resource.create',resourceType:'learning-resource',resourceId:resource.id,decision:'allow',reason:'Admin resource creation within quota',correlationId:request.correlationId!,ipAddress:request.ip},trx);
      return {resource};
    });
  });
  app.post('/api/v1/submissions',{preHandler:tenantHooks,schema:{body:{type:'object',additionalProperties:false,required:['courseId','content'],properties:{courseId:uuid,content:{type:'string',minLength:1,maxLength:10000}}}}},async(request,reply)=>{
    const body=request.body as {courseId:string;content:string};
    if(!await permit(request,reply,'submission','submit',body.courseId))return;
    return getDb().transaction().execute(async trx=>{
      const submission=await trx.insertInto('submissions').values({organization_id:request.tenant!.organizationId,course_id:body.courseId,user_id:request.auth!.userId,content:body.content,grade:null}).returningAll().executeTakeFirstOrThrow();
      await recordAuditEvent({actorId:request.auth!.userId,actorType:'user',organizationId:request.tenant!.organizationId,action:'submission.submit',resourceType:'submission',resourceId:submission.id,decision:'allow',reason:'Learner owns submission in published course',correlationId:request.correlationId!,ipAddress:request.ip},trx);return {submission};
    });
  });
  app.get('/api/v1/submissions/:submissionId',{preHandler:tenantHooks,schema:{params:idParams('submissionId')}},async(request,reply)=>{
    const {submissionId}=request.params as {submissionId:string};
    if(!await permit(request,reply,'submission','read',undefined,{submissionId}))return;
    const submission=await getDb().selectFrom('submissions').selectAll().where('id','=',submissionId).where('organization_id','=',request.tenant!.organizationId).executeTakeFirst();
    await auditRequest(request,'submission.read','allow','Owner or assigned instructor','submission',submissionId);return {submission};
  });
  app.patch('/api/v1/submissions/:submissionId/grade',{preHandler:tenantHooks,schema:{params:idParams('submissionId'),body:{type:'object',additionalProperties:false,required:['grade'],properties:{grade:{type:'integer',minimum:0,maximum:100}}}}},async(request,reply)=>{
    const {submissionId}=request.params as {submissionId:string};
    if(!await permit(request,reply,'submission','grade',undefined,{submissionId}))return;
    const result=await getDb().transaction().execute(async trx=>{
      const submission=await trx.updateTable('submissions').set({grade:(request.body as {grade:number}).grade,updated_at:new Date()})
        .where('id','=',submissionId).where('organization_id','=',request.tenant!.organizationId).returningAll().executeTakeFirstOrThrow();
      await recordAuditEvent({actorId:request.auth!.userId,actorType:'user',organizationId:request.tenant!.organizationId,action:'submission.grade',resourceType:'submission',resourceId:submissionId,decision:'allow',reason:'Assigned instructor or tenant admin',correlationId:request.correlationId!,ipAddress:request.ip},trx);
      return submission;
    });return {submission:result};
  });
  app.post('/api/v1/organizations',{preHandler:[authenticationHook],schema:{body:{type:'object',additionalProperties:false,required:['name','slug','adminUserId'],properties:{name:{type:'string',minLength:1,maxLength:255},slug:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{1,50}$'},adminUserId:uuid,maxMembers:{type:'integer',minimum:1,maximum:10000},maxResources:{type:'integer',minimum:1,maximum:10000}}}}},async(request,reply)=>{
    if(!request.auth!.platformAdmin){await auditRequest(request,'organization.provision','deny','Platform admin required');return reply.code(403).send({error:'Access denied'});}
    const key=request.headers['idempotency-key'];if(typeof key!=='string'||key.length<8||key.length>128){await auditRequest(request,'organization.provision','deny','Invalid idempotency key');return reply.code(400).send({error:'Idempotency-Key required (8-128 characters)'});}
    return provisionOrganization({...request.body as {name:string;slug:string;adminUserId:string},actorUserId:request.auth!.userId,correlationId:request.correlationId!,idempotencyKey:key});
  });
  app.patch('/api/v1/platform/organizations/:organizationId/status',{preHandler:[authenticationHook],schema:{params:idParams('organizationId'),body:{type:'object',additionalProperties:false,required:['status'],properties:{status:{type:'string',enum:['active','suspended']}}}}},async(request,reply)=>{
    if(!request.auth!.platformAdmin){await auditRequest(request,'organization.status','deny','Platform admin required');return reply.code(403).send({error:'Access denied'});}
    // Platform administration is explicit; it does not grant tenant resource access.
    return setOrganizationStatus({actorUserId:request.auth!.userId,correlationId:request.correlationId!,platformAuthorized:true,organizationId:(request.params as {organizationId:string}).organizationId,status:(request.body as {status:'active'|'suspended'}).status});
  });
  app.post('/api/v1/members',{preHandler:tenantHooks,schema:{body:{type:'object',additionalProperties:false,required:['userId'],properties:{userId:uuid,roleName:{type:'string',enum:['learner','instructor','admin']}}}}},async(request,reply)=>{
    if(!await permit(request,reply,'member','manage'))return;
    return createMember({...request.body as {userId:string;roleName?:string},actorUserId:request.auth!.userId,correlationId:request.correlationId!,organizationId:request.tenant!.organizationId});
  });
  app.post('/api/v1/consents',{preHandler:[authenticationHook],schema:{body:{type:'object',additionalProperties:false,required:['purpose','granted'],properties:{purpose:{type:'string',enum:['profile-sharing','analytics']},granted:{type:'boolean'}}}}},async(request,reply)=>{
    const organizationId=request.headers['x-organization-id'];
    if(!isUuid(organizationId)){await auditRequest(request,'consent.manage','deny','Invalid tenant selector');return reply.code(400).send({error:'Valid X-Organization-ID required'});}
    // Service validates membership; withdrawal is possible even while suspended.
    return recordConsent({...request.body as {purpose:'profile-sharing'|'analytics';granted:boolean},actorUserId:request.auth!.userId,correlationId:request.correlationId!,organizationId});
  });
  app.get('/api/v1/profiles/:userId',{preHandler:tenantHooks,schema:{params:idParams('userId')}},async(request,reply)=>{
    if(!await permit(request,reply,'profile','read'))return;
    const profile=await getSharedProfile({actorUserId:request.auth!.userId,userId:(request.params as {userId:string}).userId,organizationId:request.tenant!.organizationId,fields:['userId','displayName','bio']});
    await auditRequest(request,'profile.read','allow','Purpose-limited field projection');return {profile};
  });
  app.post('/api/v1/policies',{preHandler:tenantHooks,schema:{body:{type:'object',additionalProperties:false,required:['roleName','resource','action','effect'],properties:{roleName:{type:'string',enum:['admin','instructor','learner']},resource:{type:'string',enum:['learning-resource','submission','member','audit','profile','consent']},action:{type:'string',enum:['read','list','grade','manage','create','update','submit']},effect:{type:'string',enum:['allow','deny']}}}}},async(request,reply)=>{
    if(!await permit(request,reply,'policy','manage'))return;
    const body=request.body as {roleName:string;resource:string;action:string;effect:'allow'|'deny'};
    return getDb().transaction().execute(async trx=>{
      const row=await trx.insertInto('policy_rules').values({id:randomUUID(),organization_id:request.tenant!.organizationId,role_name:body.roleName,resource:body.resource,action:body.action,effect:body.effect}).returningAll().executeTakeFirstOrThrow();
      await recordAuditEvent({actorId:request.auth!.userId,actorType:'user',organizationId:request.tenant!.organizationId,action:'policy.update',resourceType:'policy',resourceId:row.id,decision:'allow',reason:'Tenant admin policy change',correlationId:request.correlationId!,ipAddress:request.ip},trx);return {policy:row};
    });
  });
  app.get('/api/v1/teaching-assignments',{preHandler:tenantHooks},async(request,reply)=>{
    if(!await permit(request,reply,'submission','list'))return;
    const assignments=await getDb().selectFrom('teaching_assignments').selectAll().where('user_id','=',request.auth!.userId).where('organization_id','=',request.tenant!.organizationId).execute();
    await auditRequest(request,'teaching-assignment.list','allow','Tenant-bound teaching references');return {assignments};
  });
  app.get('/api/v1/sessions',{preHandler:[authenticationHook]},async request=>{
    const sessions=await listProviderSessions(request.auth!.keycloakSub);
    await auditRequest(request,'session.list','allow','Own provider sessions only');return {sessions};
  });
  app.delete('/api/v1/sessions/:sessionId',{preHandler:[authenticationHook],schema:{params:{type:'object',additionalProperties:false,required:['sessionId'],properties:{sessionId:{type:'string',minLength:1,maxLength:128,pattern:'^[a-zA-Z0-9_-]+$'}}}}},async request=>{
    // Audit is required before the remote side effect; provider calls cannot join a DB transaction.
    await auditRequest(request,'session.revoke.request','allow','Caller-owned session revocation');
    await revokeProviderSession(request.auth!.keycloakSub,(request.params as {sessionId:string}).sessionId);
    await auditRequest(request,'session.revoke.complete','allow','Provider confirmed revocation');return {revoked:true};
  });
  app.post('/api/v1/logout-all',{preHandler:[authenticationHook]},async request=>{
    await auditRequest(request,'session.logout.request','allow','Own sessions');
    await resetProviderSessions(request.auth!.keycloakSub);
    await auditRequest(request,'session.logout.complete','allow','Provider confirmed logout');return {loggedOut:true};
  });
}
