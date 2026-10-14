import { openStore } from '../store.js';
import { Engine } from '../engine.js';
import { resolve } from 'node:path';
const opened=await openStore(resolve(process.env.DATA_DIR??'data'),process.env.DATABASE_URL);const engine=new Engine(opened.store);
export async function prepareRun(runId:string){await engine.prepareRun(runId);}
export async function executeRun(runId:string){const run=await opened.store.get('run',runId);if(!run)return;for(const p of await opened.store.list('proposal',run.companyId))if(p.runId===runId&&p.status==='approved')await engine.execute(p.companyId,p.id).catch(()=>undefined);await engine.updateRuns(run.companyId);}
export async function isComplete(runId:string){const run=await opened.store.get('run',runId);return !run||['complete','failed','cancelled'].includes(run.status);}
export async function executeProposal(companyId:string,proposalId:string){try{await engine.execute(companyId,proposalId);}catch(e:any){const p=await opened.store.get('proposal',proposalId,companyId);if(p?.status==='approved')await opened.store.put('proposal',companyId,{...p,status:'blocked',error:e.message},p.revision);}await engine.updateRuns(companyId);const p=await opened.store.get('proposal',proposalId,companyId);return {proposalId,status:p?.status};}

