import './config.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerStatic } from './static.js';
import { connectorProfile } from './connectors/profile.js';
import { SourceSync } from './source-sync.js';
import {Filings} from './filings.js';
import {productRoutes} from './product-routes.js';
import helmet from '@fastify/helmet';
import { createHmac, createHash, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { openStore } from './store.js';
import { seed, accounts as standardAccounts } from './seed.js';
import { Engine } from './engine.js';
import { Actor, DomainError, permit, insist, id, minor, money, digest, day, amount, proposalInput, billInput, scheduleInput } from './domain.js';
import { reports, consolidate } from './reports.js';
import { Connector } from './adapters.js';
import { processDocuments } from './documents.js';
import { authUsers, configuredActor, authenticateConfigured } from './identity.js';
import { taxInput, taxAmounts, taxJournal } from './tax.js';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
const directory=resolve(process.env.DATA_DIR??'data');mkdirSync(directory,{recursive:true});
const secretPath=join(directory,'session-secret');if(!existsSync(secretPath))writeFileSync(secretPath,randomBytes(48).toString('hex'),{mode:0o600});const secret=readFileSync(secretPath,'utf8');
insist(process.env.NODE_ENV!=='production'||process.env.AUTH_USERS_FILE,'Production requires configured users',503);if(process.env.AUTH_USERS_FILE)authUsers();
const opened=await openStore(directory,process.env.DATABASE_URL),store=opened.store,engine=new Engine(store);if(process.env.NODE_ENV!=='production')await seed(store);
const sourceSync=new SourceSync(store,engine),filingRecovery=new Filings(store,directory);await filingRecovery.recover();
for(const c of await store.list('company'))for(const [code,name,type] of standardAccounts)if(!await store.get('account',c.id+':'+code,c.id))await store.put('account',c.id,{id:c.id+':'+code,code,name,type,sourceId:code});
const app=Fastify({logger:true,disableRequestLogging:true,bodyLimit:10*1024*1024});await app.register(cookie);await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'",'data:','blob:'],connectSrc:["'self'"],frameAncestors:["'self'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}}});
const users=[{id:'operator',name:'Service operator',role:'operator',password:'demo'},{id:'accountant',name:'Customer accountant',role:'accountant',password:'demo'},{id:'owner',name:'Business owner',role:'owner',password:'demo'}];
const sign=(text:string)=>createHmac('sha256',secret).update(text).digest('hex');
async function actor(req:any):Promise<Actor> {const raw=req.cookies.session??'';const [payload,sig]=raw.split('.');insist(payload&&sig&&sig.length===64,'Sign in to continue',401);insist(timingSafeEqual(Buffer.from(sig),Buffer.from(sign(payload))),'Invalid session',401);const decoded=JSON.parse(Buffer.from(payload,'base64url').toString());insist(decoded.exp>Date.now(),'Session expired',401);const a=process.env.AUTH_USERS_FILE?configuredActor(decoded.id):decoded;if(a.companyIds.includes('*')){insist(a.role==='operator','Wildcard scope requires service operator',403);a.companyIds=(await store.list('company')).map(c=>c.id);}return a;}
app.addHook('onRequest',async(req,reply)=>{reply.header('X-Content-Type-Options','nosniff');if(req.url.startsWith('/api/')&&!['/api/session','/api/health','/api/ready'].includes(req.url.split('?')[0])){const user=await actor(req);(req as any).actor=user;if(!['GET','HEAD'].includes(req.method))insist(req.headers['x-csrf-token']===sign(req.cookies.session!),'Invalid request token',403);}});
app.setErrorHandler((error:any,req,reply)=>{const code=error instanceof DomainError?error.status:error instanceof z.ZodError?422:error.statusCode>=400&&error.statusCode<500?error.statusCode:500;if(code===500)req.log.error(error);reply.code(code).send({error:code===500?'Unexpected server error; check local logs':error instanceof z.ZodError?error.issues.map((i:any)=>i.path.join('.')+': '+i.message).join('; '):error.message});});
let temporal:Client|undefined;if(process.env.ORCHESTRATOR==='temporal'){const connection=await Connection.connect({address:process.env.TEMPORAL_ADDRESS??'localhost:7233'});temporal=new Client({connection,namespace:process.env.TEMPORAL_NAMESPACE??'default'});}
const user=(req:any)=>req.actor as Actor;
const access=(req:any,roles?:any)=>{const c=req.params.companyId;permit(user(req),c,roles);return c;};
productRoutes(app,store,engine,directory);
app.get('/api/ready',async()=>{await store.count();if(temporal)await temporal.workflowService.getSystemInfo({});return {status:'ready'};});
app.get('/api/health',async()=>({status:'ok',database:opened.driver,orchestrator:temporal?'temporal':'local-persistent-worker',model:process.env.MODEL_PROVIDER==='local'?'local-onnx':process.env.OPENAI_MODEL&&process.env.OPENAI_API_KEY?'configured':'rules',liveWrites:process.env.ALLOW_LIVE_WRITES==='true',release:'0.1.0',authentication:process.env.AUTH_USERS_FILE?'configured-local-accounts':'local-development-accounts'}));
const loginAttempts=new Map<string,{count:number;until:number}>();
app.post('/api/session',async(req,reply)=>{
 const key=req.ip,now=Date.now();for(const [ip,limit] of loginAttempts)if(limit.until<now)loginAttempts.delete(ip);const limit=loginAttempts.get(key)??{count:0,until:now+60000};insist(++limit.count<=15,'Too many sign-in attempts. Try again in a minute.',429);loginAttempts.set(key,limit);
 insist(process.env.AUTH_USERS_FILE||!process.env.NODE_ENV||process.env.NODE_ENV!=='production','Development login is disabled in production. Configure identity integration.',503);
 const data=z.object({username:z.string().max(200),password:z.string().max(200),otp:z.string().regex(/^\d{6}$/).optional()}).parse(req.body);const found=process.env.AUTH_USERS_FILE?authenticateConfigured(data.username,data.password,data.otp):users.find(u=>u.id===data.username);insist(found && (process.env.AUTH_USERS_FILE||timingSafeEqual(scryptSync(data.password,secret,32),scryptSync((found as any).password,secret,32))),'Invalid credentials',401);
 const configuredIds=(found as Actor).companyIds;const companyIds=process.env.AUTH_USERS_FILE&&!configuredIds.includes('*')?configuredIds:(await store.list('company')).map(c=>c.id);const payload=Buffer.from(JSON.stringify({id:found.id,name:found.name,role:found.role,companyIds,exp:Date.now()+12*3600000})).toString('base64url');const token=payload+'.'+sign(payload);reply.setCookie('session',token,{httpOnly:true,sameSite:'strict',path:'/',secure:process.env.COOKIE_SECURE==='true'||process.env.NODE_ENV==='production',maxAge:43200});return {actor:{id:found.id,name:found.name,role:found.role,companyIds},csrf:sign(token)};
});
app.get('/api/session',async(req)=>{const a=await actor(req);return {actor:a,csrf:sign(req.cookies.session!)};});
app.post('/api/logout',async(req,reply)=>{reply.clearCookie('session',{path:'/'});return {ok:true};});
app.get('/api/companies',async(req)=>(await store.list('company')).filter(c=>user(req).companyIds.includes(c.id)));
app.get('/api/companies/:companyId/workspace',async(req)=>{
 const c=access(req);const kinds=['account','bank','bill','invoice','proposal','run','schedule','document','audit','entry','operation','period','budget','sync_job','contact','settlement','filing','filing_schema','backup','question','close_signoff'];
 const out:any={company:await engine.company(c)};for(const k of kinds)out[k]=await store.list(k,c);return out;
});
app.post('/api/companies/:companyId/accounts',async(req)=>{
 const c=access(req,['accountant']);const d=z.object({code:z.string().min(1).max(50),name:z.string().min(1).max(150),type:z.enum(['asset','liability','equity','revenue','expense'])}).parse(req.body);return store.transaction(async s=>{insist(!(await s.list('account',c)).some(a=>a.code===d.code),'Account code already exists',409);const row=await s.put('account',c,{...d,id:c+':'+d.code,sourceId:d.code});await s.audit(c,'account.created',user(req).id,{accountId:row.id});return row;});
});
app.put('/api/companies/:companyId/accounts/:accountId',async(req:any)=>{
 const c=access(req,['accountant']);const d=z.object({revision:z.number().int(),type:z.enum(['asset','liability','equity','revenue','expense']),code:z.string().min(1),name:z.string().min(1)}).parse(req.body);return store.transaction(async s=>{const a=await s.get('account',req.params.accountId,c);insist(a,'Account missing',404);insist(!(await s.list('entry',c)).some(e=>e.lines.some((l:any)=>l.accountId===a.id)),'Posted account classification is immutable. Use a reviewed reclassification journal.',409);const row=await s.put('account',c,{...a,...d},d.revision);await s.audit(c,'account.classified',user(req).id,{accountId:row.id,type:d.type});return row;});
});
app.get('/api/companies/:companyId/documents/:documentId/file',async(req:any,reply)=>{
 const c=access(req),d=await store.get('document',req.params.documentId,c);insist(d,'Document missing',404);reply.header('Content-Disposition','attachment; filename="'+d.name.replace(/["\r\n\\]/g,'_')+'"').type('application/octet-stream');return readFileSync(join(directory,'artifacts',c,d.hash));
});
app.post('/api/companies/:companyId/proposals/:proposalId/source-receipt',async(req:any)=>{
 const c=access(req,['accountant']);const d=z.object({sourceId:z.string().min(1).max(200),evidence:z.string().min(10).max(2000)}).parse(req.body);return store.transaction(async s=>{const p=await s.get('proposal',req.params.proposalId,c);insist(p?.status==='outcome_unknown','Operation has no uncertain outcome',409);const op=(await s.get('operation','op:'+c+':'+p.id,c))!;const row=await s.put('operation',c,{...op,receipt:{sourceId:d.sourceId},boundEvidence:d.evidence,boundBy:user(req).id},op.revision);await s.audit(c,'operation.receipt_bound',user(req).id,{operationId:op.id,...d});return row;});
});
app.post('/api/companies',async(req)=>{
 insist(user(req).role==='operator','Only a service operator can onboard a company',403);const data=z.object({name:z.string().min(2),ledger:z.enum(['native','tally','zoho']),mode:z.enum(['native','live']),profile:connectorProfile.default({})}).parse(req.body);
 insist((data.ledger==='native')===(data.mode==='native'),'Native ledger requires native mode');const cId=id();await store.transaction(async s=>{await s.put('company',cId,{id:cId,...data,currency:'INR',period:'2026-10',policyVersion:1,coverage:data.mode==='live'?'not-synchronized':'native-local'});for(const [code,name,type] of standardAccounts)await s.put('account',cId,{id:cId+':'+code,code,name,type,sourceId:code});await s.audit(cId,'company.created',user(req).id,{ledger:data.ledger});});return {id:cId,message:'Company created. Sign in again to obtain access to the new entity.'};
});
app.put('/api/companies/:companyId/profile',async(req)=>{
 const c=access(req,['operator']);const data=z.object({revision:z.number().int(),profile:connectorProfile}).parse(req.body);const current=await engine.company(c);return store.transaction(async s=>{const row=await s.put('company',c,{...current,profile:data.profile},data.revision);await s.audit(c,'connector.configuration_changed',user(req).id,{revision:row.revision});return row;});
});
app.post('/api/companies/:companyId/sync',async(req)=>{
 const c=access(req,['operator','accountant']);return sourceSync.queue(c,user(req));
});
app.post('/api/companies/:companyId/bank/import',async(req)=>{const c=access(req,['operator','accountant']);const data=z.object({csv:z.string().max(8000000),name:z.string().default('bank.csv')}).parse(req.body);return engine.importBank(c,data.csv,data.name,user(req));});
app.post('/api/companies/:companyId/bills',async(req)=>{
 const c=access(req,['operator','accountant']),data=billInput.parse(req.body);insist(minor(data.amount)>0n,'Bill amount must be positive');insist(data.dueDate>=data.date,'Due date precedes bill date');
 const tax=data.tax?taxAmounts(data.tax):undefined;insist(!tax||minor(tax.gross)===minor(data.amount),'Gross amount does not equal configured tax base plus tax');
 return store.transaction(async s=>{insist(!(await s.list('bill',c)).some(b=>b.vendor.toLowerCase()===data.vendor.toLowerCase()&&b.reference===data.reference),'This vendor bill already exists',409);if(data.documentId)insist(await s.get('document',data.documentId,c),'Evidence document is missing');const row=await s.put('bill',c,{...data,tax,netPayable:tax?.netPayable??data.amount,status:'draft',evidence:data.documentId?[data.documentId]:[]});await s.audit(c,'bill.created',user(req).id,{id:row.id});return row;});
});
app.post('/api/companies/:companyId/invoices',async(req)=>{
 const c=access(req,['operator','accountant']);const d=z.object({customer:z.string().min(1),reference:z.string().min(1),date:day,dueDate:day,amount,tax:taxInput.optional()}).parse(req.body);insist(minor(d.amount)>0n,'Invoice amount must be positive');insist(d.dueDate>=d.date,'Due date precedes invoice date');const tax=d.tax?taxAmounts(d.tax):undefined;insist(!tax||minor(tax.gross)===minor(d.amount),'Gross amount does not match configured tax');const ar=await engine.account(c,'1100'),revenue=await engine.account(c,'4000');const lines=tax?taxJournal(c,revenue,ar,tax,true):[{accountId:ar,debit:d.amount,credit:'0.00'},{accountId:revenue,debit:'0.00',credit:d.amount}];
 return store.transaction(async s=>{insist(!(await s.list('invoice',c)).some(i=>i.reference===d.reference),'Invoice reference already exists',409);const source=await s.put('invoice',c,{...d,tax,status:'draft'});return engine.createProposal(c,{date:d.date,description:'Invoice '+d.reference+' · '+d.customer,lines,evidence:[source.id],questions:[],sourceKind:'invoice',sourceId:source.id,sourceRevision:source.revision},user(req).id,s);});
});
app.post('/api/companies/:companyId/tax/calculate',async(req)=>{access(req);return taxAmounts(req.body);});
app.get('/api/companies/:companyId/tax/workpaper',async(req:any)=>{
 const c=access(req),period=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.period);const purchases=(await store.list('bill',c)).filter(b=>b.tax&&b.date.startsWith(period)&&['posted','paid'].includes(b.status)),sales=(await store.list('invoice',c)).filter(b=>b.tax&&b.date.startsWith(period)&&['posted','paid'].includes(b.status));return {period,purchases,sales,status:'accountant-review-required',basis:'Configured tax values; includes only tagged, posted transactions. Not a filing or an ITC eligibility determination.'};
});
app.post('/api/companies/:companyId/schedules',async(req)=>{const c=access(req,['operator','accountant']);const d=scheduleInput.parse(req.body);insist(minor(d.amount)>0n,'Amount must be positive');return store.put('schedule',c,{...d,status:'active'});});
app.post('/api/companies/:companyId/proposals',async(req)=>engine.createProposal(access(req,['operator','accountant']),proposalInput.parse(req.body),user(req).id));
app.put('/api/companies/:companyId/proposals/:proposalId',async(req:any)=>{const c=access(req,['operator','accountant']);const d=z.object({revision:z.number().int(),date:day,description:z.string(),lines:z.array(z.object({accountId:z.string(),debit:amount,credit:amount})),evidence:z.array(z.string()).default([]),answers:z.array(z.string()).default([]),relatedId:z.string().nullable().optional()}).parse(req.body);return engine.editProposal(c,req.params.proposalId,d,d.revision,d.answers,user(req));});
app.post('/api/companies/:companyId/proposals/:proposalId/approve',async(req:any)=>{const c=access(req,['accountant']);const d=z.object({revision:z.number().int(),reject:z.boolean().default(false)}).parse(req.body);const result=await engine.approve(c,req.params.proposalId,d.revision,user(req),d.reject);if(temporal&&!d.reject){if(result.runId){try{await temporal.workflow.start('accountingRun',{args:[result.runId],taskQueue:'accounting',workflowId:'run:'+result.runId});}catch(e){if(!(e instanceof WorkflowExecutionAlreadyStartedError))throw e;}await temporal.workflow.getHandle('run:'+result.runId).signal('approvalRecorded');}else await temporal.workflow.start('accountingProposal',{args:[c,result.id],taskQueue:'accounting',workflowId:'proposal:'+c+':'+result.id});}return result;});
app.post('/api/companies/:companyId/proposals/:proposalId/execute',async(req:any)=>{const c=access(req,['operator','accountant']);return engine.execute(c,req.params.proposalId);});
app.post('/api/companies/:companyId/proposals/:proposalId/reconcile',async(req:any)=>engine.reconcile(access(req,['operator','accountant']),req.params.proposalId,user(req)));
app.post('/api/companies/:companyId/entries/:entryId/reverse',async(req:any)=>{const c=access(req,['operator','accountant']);const d=z.object({date:day}).parse(req.body);return engine.reverse(c,req.params.entryId,d.date,user(req));});
app.post('/api/companies/:companyId/runs',async(req:any)=>{const c=access(req,['operator','accountant']);const d=z.object({type:z.enum(['reconciliation','bills','close','schedules']),period:z.string()}).parse(req.body);const run=await engine.startRun(c,d.type,d.period,user(req));if(temporal)await temporal.workflow.start('accountingRun',{args:[run.id],taskQueue:'accounting',workflowId:'run:'+run.id});return run;});
app.post('/api/companies/:companyId/periods/:period/lock',async(req:any)=>engine.closePeriod(access(req,['accountant']),req.params.period,user(req)));
app.get('/api/companies/:companyId/reports',async(req:any)=>{const c=access(req),q=z.object({date:day.default('2026-10-31'),from:day.optional()}).parse(req.query);return reports(store,c,q.date,q.from);});
app.get('/api/companies/:companyId/workpaper',async(req:any,reply)=>{const c=access(req),q=z.object({date:day.default('2026-10-31')}).parse(req.query);const report=await reports(store,c,q.date);const proposals=await store.list('proposal',c),operations=await store.list('operation',c);const escape=(v:any)=>'"'+String(v).replace(/"/g,'""')+'"';const lines=[['account','name','debit','credit'],...report.trialBalance.map(a=>[a.code,a.name,a.debit,a.credit])];reply.header('Content-Disposition','attachment; filename="trial-balance-'+q.date+'.csv"').type('text/csv');return lines.map(r=>r.map(escape).join(',')).join('\r\n');});
app.get('/api/companies/:companyId/evidence',async(req:any,reply)=>{const c=access(req);const output:any={company:await engine.company(c),exportedAt:new Date().toISOString()};for(const k of ['proposal','approval','operation','entry','audit','period','import','bill','invoice','bank','document','settlement','close_signoff','filing','filing_approval','filing_receipt'])output[k]=await store.list(k,c);reply.header('Content-Disposition','attachment; filename="accounting-evidence.json"').type('application/json');return output;});
app.post('/api/companies/:companyId/documents',async(req)=>{
 const c=access(req,['operator','accountant','owner']);const d=z.object({name:z.string().min(1).max(200),content:z.string().max(8000000),encoding:z.enum(['text','base64']).default('text'),mediaType:z.string().default('text/plain')}).parse(req.body);const bytes=d.encoding==='base64'?Buffer.from(d.content,'base64'):Buffer.from(d.content);insist(bytes.length<=6*1024*1024,'Document exceeds 6MB');const hash=createHash('sha256').update(bytes).digest('hex');const artifactDir=join(directory,'artifacts',c);mkdirSync(artifactDir,{recursive:true});writeFileSync(join(artifactDir,hash),bytes);const text=d.encoding==='text'?d.content:'';const record=await store.put('document',c,{name:d.name,hash,bytes:bytes.length,mediaType:d.mediaType,text,processing:'queued',evidence:'sha256:'+hash});return record;
});
app.post('/api/companies/:companyId/budget',async(req)=>{
 const c=access(req,['operator','accountant']);const d=z.object({period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),lines:z.array(z.object({accountId:z.string(),amount})).max(100)}).parse(req.body);const old=(await store.list('budget',c)).find(b=>b.period===d.period);return store.put('budget',c,{...d,id:old?.id},old?.revision);
});
app.post('/api/consolidation',async(req)=>{
 const d=z.object({companyIds:z.array(z.string()).min(2),date:day,rates:z.record(z.string()).default({}),eliminations:z.array(z.object({key:z.string(),debit:amount,credit:amount})).default([])}).parse(req.body);d.companyIds.forEach(c=>permit(user(req),c));return consolidate(store,d.companyIds,d.date,d.rates,d.eliminations);
});
registerStatic(app,resolve('dist'));
await engine.upgradePreparedProposals();
await engine.recover();
if(temporal){for(const run of await store.list('run'))if(['queued','processing','awaiting_review','ready'].includes(run.status)){try{await temporal.workflow.start('accountingRun',{args:[run.id],taskQueue:'accounting',workflowId:'run:'+run.id});}catch(e){if(!(e instanceof WorkflowExecutionAlreadyStartedError))throw e;}if((await store.list('proposal',run.companyId)).some(p=>p.runId===run.id&&p.status==='approved'))await temporal.workflow.getHandle('run:'+run.id).signal('approvalRecorded');}for(const p of await store.list('proposal'))if(p.status==='approved'&&!p.runId){try{await temporal.workflow.start('accountingProposal',{args:[p.companyId,p.id],taskQueue:'accounting',workflowId:'proposal:'+p.companyId+':'+p.id});}catch(e){if(!(e instanceof WorkflowExecutionAlreadyStartedError))throw e;}}}
let busy=false,documentBusy=false,syncBusy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{if(!temporal)await engine.tick();}catch(e){app.log.error(e);}finally{busy=false;}},1500);
const documentTimer=setInterval(async()=>{if(documentBusy)return;documentBusy=true;try{await processDocuments(store,directory);}catch(e){app.log.error(e);}finally{documentBusy=false;}},3000);
const filingTimer=setInterval(()=>filingRecovery.recover().catch(e=>app.log.error(e)),30000);
const syncTimer=setInterval(async()=>{if(syncBusy)return;syncBusy=true;try{await sourceSync.tick();}catch(e){app.log.error(e);}finally{syncBusy=false;}},3000);
for(const r of await store.list('run'))if(r.status==='processing'&&!temporal)await store.put('run',r.companyId,{...r,status:'queued'},r.revision);
app.addHook('onClose',async()=>{clearInterval(timer);clearInterval(documentTimer);clearInterval(syncTimer);clearInterval(filingTimer);await opened.close();});
await app.listen({port:Number(process.env.PORT??4310),host:process.env.HOST??'127.0.0.1'});

