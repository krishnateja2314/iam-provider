import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import dotenv from 'dotenv';
import { initJwks } from './modules/auth/token-validator.js';
import { registerRoutes } from './routes.js';
import { correlationIdHook, auditRequest } from './middleware.js';
import { closeDb } from './db/connection.js';
import { ProvisioningError } from './modules/provisioning/provisioning-service.js';

dotenv.config();
const app=Fastify({
  logger:{level:process.env.LOG_LEVEL??'info',redact:['req.headers.authorization','req.headers.cookie','req.body','res.headers.set-cookie']},
  trustProxy:false,
  bodyLimit:32768,
});

async function start():Promise<void> {
  if(!process.env.JWT_ISSUER||!process.env.JWT_AUDIENCE||!process.env.DATABASE_URL) throw new Error('JWT_ISSUER, JWT_AUDIENCE and DATABASE_URL are required');
  await app.register(helmet);
  const origins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:5173','http://localhost:3100'];
  await app.register(cors,{origin:origins,methods:['GET','POST','PATCH','DELETE'],allowedHeaders:['Authorization','Content-Type','X-Organization-ID','X-Correlation-ID','Idempotency-Key']});
  app.addHook('onRequest',correlationIdHook);
  initJwks(process.env.JWT_ISSUER);
  registerRoutes(app);
  app.setErrorHandler(async(error,request,reply)=>{
    const known=error as {statusCode?:number;code?:string;message?:string;validation?:unknown};
    const dbCode=(error as {code?:string}).code;
    const status=error instanceof ProvisioningError?({conflict:409,quota_exceeded:409,forbidden:403,invalid_input:400,not_found:404}[error.code]):dbCode==='23505'?409:dbCode==='23503'?400:dbCode==='P0001'?409:known.statusCode??500;
    // Record validation/operation failures without storing attacker payloads.
    try {await auditRequest(request,'request.error',status<500?'deny':'error',known.validation?'Request schema validation failed':'Operation failed');}
    catch {reply.code(503).send({error:'Audit unavailable',code:'AUDIT_UNAVAILABLE'});return;}
    reply.code(status).send({error:status>=500?'Service unavailable':known.validation?'Invalid request':known.message??'Request rejected',code:known.code??'REQUEST_ERROR'});
  });
  const port=Number(process.env.BACKEND_PORT??3100);
  await app.listen({port,host:process.env.BACKEND_HOST??'0.0.0.0'});
  app.log.info({port},'IAM API ready');
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{await app.close();await closeDb();process.exit(0);});
start().catch(()=>{console.error('Backend startup failed; verify service configuration');process.exitCode=1;});
