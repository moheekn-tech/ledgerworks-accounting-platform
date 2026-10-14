import { proxyActivities, defineSignal, setHandler, condition } from '@temporalio/workflow';
import type * as activities from './activities.js';
const a=proxyActivities<typeof activities>({startToCloseTimeout:'5 minutes',retry:{maximumAttempts:1}});
export const wake=defineSignal('approvalRecorded');
export async function accountingRun(runId:string){
 await a.prepareRun(runId);let notified=false;setHandler(wake,()=>{notified=true;});
 while(!(await a.isComplete(runId))){await condition(()=>notified,'1 hour');notified=false;await a.executeRun(runId);}
 return {runId,status:'complete'};
}
export async function accountingProposal(companyId:string,proposalId:string){return a.executeProposal(companyId,proposalId);}

