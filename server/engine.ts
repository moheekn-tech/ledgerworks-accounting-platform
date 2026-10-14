import { Store } from './store.js';
import { Actor, Row, id, digest, effectDigest, insist, minor, money, permit, periodOf, nextMonth, proposalInput } from './domain.js';
import { proposeCoding } from './model.js';
import { Connector, ConnectorOptions } from './adapters.js';
import { reports } from './reports.js';
import { parse } from 'csv-parse/sync';
import { taxJournal } from './tax.js';

export class Engine {
 constructor(public store:Store,public connector:(c:Row,options?:ConnectorOptions)=>Connector=(c,options)=>new Connector(c,options)) {}
 async upgradePreparedProposals(){for(const p of await this.store.list('proposal')){if(p.effectVersion===2||['verified','rejected','superseded','dispatching','outcome_unknown'].includes(p.status))continue;await this.store.transaction(async s=>{const c=(await s.get('company',p.companyId))!;const next:any={...p,effectVersion:2,companyRevision:c.revision,policyVersion:c.policyVersion,status:p.questions?.length?'needs_input':'ready_for_review'};try{Object.assign(next,await this.sourcePlan(s,c,next));}catch(e:any){next.questions=[...(next.questions??[]),e.message];next.status='needs_input';}next.payloadDigest=effectDigest(next);await s.put('proposal',p.companyId,next,p.revision);await s.audit(p.companyId,'proposal.review_upgraded','system',{proposalId:p.id,priorRevision:p.revision});});}}
 async sourcePlan(s:Store,c:Row,p:any){const source=p.sourceKind?await s.get(p.sourceKind,p.sourceId,c.id):undefined,related=p.relatedId?(await s.get('invoice',p.relatedId,c.id)??await s.get('bill',p.relatedId,c.id)):undefined;if(source&&['bill','invoice'].includes(p.sourceKind)){const sale=p.sourceKind==='invoice',control=c.id+':'+(sale?'1100':'2000'),net=p.lines.filter((l:any)=>l.accountId===control).reduce((n:bigint,l:any)=>n+minor(l.debit)-minor(l.credit),0n),debits=p.lines.reduce((n:bigint,l:any)=>n+minor(l.debit),0n);insist(p.date===source.date&&debits===minor(source.amount)&&net===minor(sale?source.amount:source.netPayable??source.amount)*(sale?1n:-1n),'Document accounting must preserve its date, gross and exact control-account amount');}
 return {writePlan:this.connector(c).plan(p,source,related),sourceRevision:source?.revision,relatedRevision:related?.revision};}
 async company(companyId:string){const c=await this.store.get('company',companyId);insist(c,'Company not found',404);return c;}
 async account(companyId:string,code:string){const a=(await this.store.list('account',companyId)).find(a=>a.code===code);insist(a,'Account '+code+' is missing');return a.id;}
 async validate(s:Store,companyId:string,proposal:any){
  proposalInput.parse(proposal);const accounts=await s.list('account',companyId);let debit=0n,credit=0n;
  for(const l of proposal.lines){insist(accounts.some(a=>a.id===l.accountId && a.type!=='unmapped'),'Account is missing or unmapped');const d=minor(l.debit),c=minor(l.credit);insist(d>=0n&&c>=0n&&(d===0n)!==(c===0n),'Each line needs one positive debit or credit');debit+=d;credit+=c;}
  insist(debit>0n&&debit===credit,'Journal must have equal, positive debits and credits');
  insist(new Set(proposal.lines.map((l:any)=>l.accountId)).size>=2,'Journal requires at least two distinct accounts');
  const period=await s.get('period',companyId+':'+periodOf(proposal.date),companyId);insist(period?.status!=='locked','Accounting period is locked',409);
  return true;
 }
 async createProposal(companyId:string,data:any,actorId='system',s=this.store):Promise<Row>{
  if(s===this.store)return this.store.transaction(tx=>this.createProposal(companyId,data,actorId,tx));
  const c=await s.get('company',companyId);insist(c,'Company not found',404);await this.validate(s,companyId,data);
  const rowId=data.id??id(),previous=await s.get('proposal',rowId,companyId);if(previous)return previous;
  const proposed:any={...data,id:rowId,effectVersion:2,status:data.questions?.length?'needs_input':'ready_for_review',policyVersion:c.policyVersion,companyRevision:c.revision,sourceMode:c.mode};try{Object.assign(proposed,await this.sourcePlan(s,c,proposed));}catch(e:any){proposed.planningError=e.message;proposed.questions=[...(data.questions??[]),'Resolve connector mapping/preparation: '+e.message];proposed.status='needs_input';}proposed.payloadDigest=effectDigest(proposed);
  const row=await s.put('proposal',companyId,proposed);await s.audit(companyId,'proposal.prepared',actorId,{proposalId:row.id,digest:row.payloadDigest});
  return row;
 }
 async importBank(companyId:string,csv:string,sourceName:string,actor:Actor){
  permit(actor,companyId,['operator','accountant']);const parsed:any[]=parse(csv,{columns:true,skip_empty_lines:true,bom:true,trim:true,max_record_size:100000});insist(parsed.length>0&&parsed.length<=10000,'CSV must have 1–10,000 rows');
  const normalized=parsed.map((r,i)=>{const date=r.date??r.Date,description=r.description??r.Description,raw=r.amount??r.Amount;insist(date&&description&&raw!==undefined,'Columns required: date, description, amount');proposalInput.shape.date.parse(date);minor(String(raw));return {date,description:String(description),amount:money(minor(String(raw))),sourceId:String(r.source_id??r.SourceId??''),index:i};});
  const importId=digest({companyId,csv});let added=0;
  await this.store.transaction(async s=>{if(await s.get('import',importId,companyId))return;const existing=await s.list('bank',companyId);
    for(const r of normalized){if(r.sourceId&&existing.some(e=>e.sourceId===r.sourceId)){const same=existing.find(e=>e.sourceId===r.sourceId)!;insist(same.date===r.date&&same.amount===r.amount&&same.description===r.description,'Source ID changed; import a correction instead of overwriting');continue;}
      const fingerprint=digest({date:r.date,description:r.description,amount:r.amount});const duplicateCandidate=existing.some(e=>e.fingerprint===fingerprint);await s.put('bank',companyId,{...r,id:importId+':'+r.index,fingerprint,duplicateCandidate,sourceId:r.sourceId||importId+':'+r.index,status:'unreviewed',evidence:[importId],origin:'csv'});added++;}
    await s.put('import',companyId,{id:importId,name:sourceName,rows:normalized.length,digest:importId,coverage:'uploaded-rows',rawCsv:csv,dateRange:[normalized[0].date,normalized.at(-1)!.date]});await s.audit(companyId,'bank.imported',actor.id,{importId,added});
  });return {added,importId};
 }
 async startRun(companyId:string,type:string,period:string,actor:Actor){
  permit(actor,companyId,['operator','accountant']);insist(['reconciliation','bills','close','schedules'].includes(type),'Unknown workflow');insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(period),'Invalid period');
  const run=await this.store.put('run',companyId,{type,period,status:'queued',steps:[],proposals:[],createdBy:actor.id});await this.store.audit(companyId,'workflow.started',actor.id,{runId:run.id,type,period});return run;
 }
 async prepareRun(runId:string){
  const run=await this.store.get('run',runId);insist(run,'Run not found',404);if(run.status!=='queued'&&run.status!=='processing')return run;
  let current=await this.store.transaction(async s=>{const r=(await s.get('run',runId))!;return s.put('run',r.companyId,{...r,status:'processing',steps:[{name:'Acquire and validate source records',status:'complete'},{name:'Prepare accounting proposals',status:'running'}]},r.revision);});
  try {
   const company=await this.company(run.companyId);const accounts=await this.store.list('account',run.companyId);const bank=await this.account(run.companyId,'1000');const ap=await this.account(run.companyId,'2000');const ar=await this.account(run.companyId,'1100');const proposalIds:string[]=[];let questions=0;
   if(run.type==='bills'){
    for(const bill of (await this.store.list('bill',run.companyId)).filter(b=>b.date.startsWith(run.period)&&b.status==='draft')){
     const active=(await this.store.list('proposal',run.companyId)).find(p=>p.sourceKind==='bill'&&p.sourceId===bill.id&&!['rejected','superseded'].includes(p.status));if(active){proposalIds.push(active.id);continue;}
     const coding=bill.accountId?{accountId:bill.accountId,questions:[],reason:'Account supplied with document',method:'manual'}:await proposeCoding(bill.vendor+' '+bill.memo,accounts.filter(a=>a.type==='expense'||a.type==='asset'),!!company.profile.modelEnabled);
     const p=await this.createProposal(run.companyId,{id:run.id+':bill:'+bill.id,runId:run.id,date:bill.date,description:'Bill '+bill.reference+' · '+bill.vendor,lines:bill.tax?taxJournal(run.companyId,coding.accountId,ap,bill.tax):[{accountId:coding.accountId,debit:bill.amount,credit:'0.00'},{accountId:ap,debit:'0.00',credit:bill.amount}],evidence:bill.evidence??[],questions:coding.questions,reason:coding.reason,method:coding.method,sourceKind:'bill',sourceId:bill.id,sourceRevision:bill.revision,sourceDigest:digest({vendor:bill.vendor,reference:bill.reference,amount:bill.amount,date:bill.date})});
     proposalIds.push(p.id);questions+=p.questions?.length??0;
    }
   }
   if(run.type==='reconciliation'){
    for(const b of (await this.store.list('bank',run.companyId)).filter(b=>b.date.startsWith(run.period)&&b.status!=='matched')){const lineBank=b.accountId??bank;
     if((await this.store.list('proposal',run.companyId)).some(p=>p.sourceKind==='bank'&&p.sourceId===b.id&& !['rejected','superseded'].includes(p.status)))continue;
     const n=minor(b.amount);const evidence=[...(b.evidence??[])];let offset:string,reason:string,qs:string[]=[];
     if(b.duplicateCandidate)qs.push('This row overlaps an earlier import. Confirm it is a separate transaction.');
     let related:string|undefined;
     if(n>0n){
      const invoices=(await this.store.list('invoice',run.companyId)).filter(i=>i.status==='posted'&&minor(i.outstanding??i.amount)>=n&&b.description.includes(i.reference));
      if(invoices.length===1){offset=ar;related=invoices[0].id;reason='Unique invoice reference and exact amount match';evidence.push(invoices[0].id);}else{offset=await this.account(run.companyId,'4000');reason='Incoming payment requires business purpose';qs.push('Which invoice or revenue source does this receipt settle?');}
     } else {
      const candidates=(await this.store.list('bill',run.companyId)).filter(i=>['draft','posted'].includes(i.status)&&minor(i.outstanding??i.netPayable??i.amount)>=-n),vendorMatches=candidates.filter(i=>b.description.toLowerCase().includes(i.vendor.toLowerCase())),bills=vendorMatches.length?vendorMatches:candidates.filter(i=>minor(i.outstanding??i.netPayable??i.amount)===-n);
      if(bills.length===1){offset=ap;related=bills[0].id;reason=vendorMatches.length?'Vendor and amount match an existing bill':'Exact amount matches one bill; relationship requires confirmation';evidence.push(bills[0].id);if(!vendorMatches.length)qs.push('Confirm this payment settles '+bills[0].reference+'. If unrelated, remove the linked bill and select the actual offset account.');if(bills[0].status==='draft')qs.push('Prepare and approve the linked bill before approving its bank settlement.');}
      else{const coding=await proposeCoding(b.description,accounts.filter(a=>a.type==='expense'||a.type==='asset'),!!company.profile.modelEnabled);offset=coding.accountId;reason=coding.reason;qs.push(...coding.questions);if(/transfer|savings|owner|loan/i.test(b.description))qs.push('Identify the destination account or liability; do not treat this movement as an expense.');}
     }
     insist(n!==0n,'Zero-value statement line is not a posting');
     const abs=money(n<0n?-n:n);const lines=n>0n?[{accountId:lineBank,debit:abs,credit:'0.00'},{accountId:offset,debit:'0.00',credit:abs}]:[{accountId:offset,debit:abs,credit:'0.00'},{accountId:lineBank,debit:'0.00',credit:abs}];
     const p=await this.createProposal(run.companyId,{id:run.id+':bank:'+b.id,runId:run.id,date:b.date,description:b.description,lines,evidence,questions:qs,reason,sourceKind:'bank',sourceId:b.id,sourceRevision:b.revision,sourceDigest:digest({date:b.date,description:b.description,amount:b.amount}),relatedId:related});proposalIds.push(p.id);questions+=qs.length;
    }
   }
   if(run.type==='close'||run.type==='schedules'){
    const date=new Date(Number(run.period.slice(0,4)),Number(run.period.slice(5)),0);const last=run.period+'-'+String(date.getDate()).padStart(2,'0');
    for(const sch of (await this.store.list('schedule',run.companyId)).filter(s=>s.status==='active'&&s.startDate.slice(0,7)<=run.period)){
     const a=sch.startDate.slice(0,7).split('-').map(Number),b=run.period.split('-').map(Number);const index=(b[0]-a[0])*12+b[1]-a[1];if(index>=sch.months)continue;
     const total=minor(sch.amount);insist(total>0n,'Schedule amount must be positive');const base=total/BigInt(sch.months),allocation=base+(index===sch.months-1?total%BigInt(sch.months):0n);
     if((await this.store.list('entry',run.companyId)).some(e=>e.scheduleId===sch.id&&e.date.startsWith(run.period)))continue;
     const active=(await this.store.list('proposal',run.companyId)).find(p=>p.sourceKind==='schedule'&&p.sourceId===sch.id&&p.date.startsWith(run.period)&&!['rejected','superseded'].includes(p.status));if(active){proposalIds.push(active.id);continue;}
     const p=await this.createProposal(run.companyId,{id:run.id+':schedule:'+sch.id,runId:run.id,date:last,description:sch.name+' · '+run.period,lines:[{accountId:sch.accountId,debit:money(allocation),credit:'0.00'},{accountId:sch.offsetAccountId,debit:'0.00',credit:money(allocation)}],evidence:sch.evidence,questions:[],reason:'Exact allocation under configured schedule; residual cents in final period',sourceKind:'schedule',sourceId:sch.id,sourceRevision:sch.revision,sourceDigest:digest({amount:sch.amount,months:sch.months,accountId:sch.accountId,offsetAccountId:sch.offsetAccountId}),scheduleId:sch.id,autoReverse:sch.autoReverse});proposalIds.push(p.id);
    }
   }
   const r=(await this.store.get('run',run.id))!;current=await this.store.put('run',run.companyId,{...r,status:proposalIds.length?'awaiting_review':'ready',proposals:proposalIds,questions,steps:[{name:'Acquire and validate source records',status:'complete'},{name:'Prepare accounting proposals',status:'complete'},{name:'Accountant review',status:proposalIds.length?'waiting':'complete'},{name:'Verify ledger effects',status:'pending'}]},r.revision);
   await this.store.audit(run.companyId,'workflow.prepared','system',{runId:run.id,proposals:proposalIds.length});return current;
  }catch(e:any){const r=(await this.store.get('run',runId))!;await this.store.put('run',r.companyId,{...r,status:'failed',error:e.message},r.revision);throw e;}
 }
 async editProposal(companyId:string,proposalId:string,input:any,revision:number,answers:string[],actor:Actor){
  permit(actor,companyId,['operator','accountant']);const data=proposalInput.parse(input);
  return this.store.transaction(async s=>{const p=await s.get('proposal',proposalId,companyId);insist(p,'Proposal not found',404);insist(p.revision===revision,'Proposal changed',409);insist(!['verified','dispatching','outcome_unknown'].includes(p.status),'Cannot change a dispatched proposal',409);await this.validate(s,companyId,data);insist(answers.length===(p.questions??[]).length && answers.every(a=>a.trim().length>2),'Answer every open question before review');
   const relatedId=input.relatedId===null?undefined:input.relatedId??p.relatedId;if(relatedId)insist(p.sourceKind==='bank'&&((await s.get('invoice',relatedId,companyId))||(await s.get('bill',relatedId,companyId))),'Linked accounting source is missing');const c=(await s.get('company',companyId))!;const revised:any={...p,...data,relatedId,answers,status:'ready_for_review',planningError:undefined,companyRevision:c.revision,policyVersion:c.policyVersion,sourceMode:c.mode};Object.assign(revised,await this.sourcePlan(s,c,revised));revised.payloadDigest=effectDigest(revised);const row=await s.put('proposal',companyId,revised,p.revision);await s.audit(companyId,'proposal.revised',actor.id,{proposalId,revision:row.revision});return row;});
 }
 async approve(companyId:string,proposalId:string,revision:number,actor:Actor,reject=false){
  permit(actor,companyId,['accountant']);
  return this.store.transaction(async s=>{const p=await s.get('proposal',proposalId,companyId);insist(p,'Proposal not found',404);insist(p.revision===revision,'Proposal changed; approval requires current revision',409);insist(p.status==='ready_for_review','Resolve questions before approval',409);await this.validate(s,companyId,p);
   if(!reject)await s.put('approval',companyId,{id:p.id+':'+p.revision,proposalId:p.id,proposalRevision:p.revision,payloadDigest:p.payloadDigest,approvedBy:actor.id,role:actor.role});
   const row=await s.put('proposal',companyId,{...p,status:reject?'rejected':'approved',approvedRevision:reject?undefined:p.revision},p.revision);await s.audit(companyId,reject?'proposal.rejected':'proposal.approved',actor.id,{proposalId,revision,payloadDigest:p.payloadDigest});return row;});
 }
 async execute(companyId:string,proposalId:string){
  const opId='op:'+companyId+':'+proposalId;let p:Row|undefined,c:Row|undefined,operation:Row|undefined;
  await this.store.transaction(async s=>{
   p=await s.get('proposal',proposalId,companyId);c=await s.get('company',companyId);insist(p&&c,'Proposal or company missing',404);
   if(p.status==='verified'){operation=await s.get('operation',opId,companyId);return;}
   insist(p.status==='approved','Only an approved proposal can dispatch',409);await this.validate(s,companyId,p);
   insist(effectDigest(p)===p.payloadDigest,'Accounting effect changed after preparation',409);
   const approval=await s.get('approval',p.id+':'+p.approvedRevision,companyId);insist(approval?.payloadDigest===p.payloadDigest,'Approval does not bind this payload',409);
   insist(c.revision===p.companyRevision && c.mode===p.sourceMode,'Connector configuration changed; reprepare before posting',409);
   if(p.sourceKind&&p.sourceId){const source=await s.get(p.sourceKind,p.sourceId,companyId);insist(source&&source.revision===p.sourceRevision,'Source changed; reprepare before posting',409);if(p.sourceKind==='bank'){const bankId=source.accountId??companyId+':1000',net=p.lines.filter((l:any)=>l.accountId===bankId).reduce((n:bigint,l:any)=>n+minor(l.debit)-minor(l.credit),0n);insist(p.lines.length===2&&net===minor(source.amount),'Statement accounting must use two accounts and its exact signed amount',409);}}
   if(p.relatedId){const related=await s.get('invoice',p.relatedId,companyId)??await s.get('bill',p.relatedId,companyId);insist(related?.revision===p.relatedRevision,'Linked source changed; refresh the payment proposal',409);insist(related?.status==='posted','Linked bill or invoice must be posted and unsettled before payment',409);const sale=related.kind==='invoice',offset=(await s.list('account',companyId)).find(a=>a.code===(sale?'1100':'2000'));const settlement=p.lines.filter((l:any)=>l.accountId===offset?.id).reduce((n:bigint,l:any)=>n+minor(l.debit)-minor(l.credit),0n),expected=minor(related.outstanding??related.netPayable??related.amount)*(sale?-1n:1n);insist(settlement!==0n&&(sale?settlement<0n&&settlement>=expected:settlement>0n&&settlement<=expected),'Settlement must use the correct receivable/payable account and no more than the outstanding amount',409);const allocated=(await s.list('proposal',companyId)).some(other=>other.id!==p!.id&&other.relatedId===p!.relatedId&&['dispatching','outcome_unknown'].includes(other.status));insist(!allocated,'Linked bill or invoice already has an admitted settlement',409);}
   const conflict=p.sourceKind&&p.sourceId?(await s.list('proposal',companyId)).find(other=>other.id!==p!.id&&other.sourceKind===p!.sourceKind&&other.sourceId===p!.sourceId&&(p!.sourceKind!=='schedule'||periodOf(other.date)===periodOf(p!.date))&&['dispatching','outcome_unknown','verified'].includes(other.status)):undefined;insist(!conflict,'Source already allocated to another operation',409);
   const previous=await s.get('operation',opId,companyId);insist(!previous,'Operation already admitted; reconcile instead of redispatch',409);
   operation=await s.put('operation',companyId,{id:opId,proposalId:p.id,payloadDigest:p.payloadDigest,status:'dispatching',attempts:1});p=await s.put('proposal',companyId,{...p,status:'dispatching'},p.revision);
  });
  if(p!.status==='verified')return p;
  let receipt:any;
  try {
   const adapter=this.connector(c!,{checkpoint:async r=>{await this.store.transaction(async s=>{const op=(await s.get('operation',opId,companyId))!;await s.put('operation',companyId,{...op,receipt:r},op.revision);await s.audit(companyId,'operation.source_receipt','system',{operationId:opId,sourceId:r.sourceId,resource:r.resource});});}});
   if(c!.ledger==='native')receipt={sourceId:opId,native:true};else receipt=await adapter.dispatch(p!,opId);
   const checked=c!.ledger==='native'?{verified:true,sourceId:opId}:await adapter.verify(p!,opId,receipt);
   await this.finish(companyId,p!,operation!,receipt,checked);return this.store.get('proposal',proposalId,companyId);
  }catch(e:any){
   receipt=receipt??e.receipt;
   await this.store.transaction(async s=>{const op=(await s.get('operation',opId,companyId))!;await s.put('operation',companyId,{...op,status:'outcome_unknown',receipt,error:e.message},op.revision);const current=(await s.get('proposal',proposalId,companyId))!;await s.put('proposal',companyId,{...current,status:'outcome_unknown',error:e.message},current.revision);await s.audit(companyId,'operation.outcome_unknown','system',{operationId:opId,error:e.message});});throw e;
  }
 }
 async finish(companyId:string,proposal:Row,operation:Row,receipt:any,checked:any){
  await this.store.transaction(async s=>{const p=(await s.get('proposal',proposal.id,companyId))!,op=(await s.get('operation',operation.id,companyId))!;await this.validate(s,companyId,p);
   if(op.status==='verified')return;
   insist(p.payloadDigest===op.payloadDigest,'Admitted payload changed',409);
   if(receipt.native){const company=await s.get('company',companyId);insist(company?.revision===p.companyRevision,'Native configuration changed after admission',409);if(p.sourceKind){const source=await s.get(p.sourceKind,p.sourceId,companyId);insist(source?.revision===p.sourceRevision,'Native source changed after admission',409);}}
   if(!(await s.get('entry',op.id,companyId)))await s.put('entry',companyId,{id:op.id,date:p.date,description:p.description,lines:p.lines,operationId:op.id,evidence:p.evidence,verified:true,sourceId:receipt.sourceId,sourceKind:p.sourceKind,sourceRecordId:p.sourceId,relatedId:p.relatedId,origin:receipt.fixture?'fixture':receipt.native?'native':'source-readback',scheduleId:p.scheduleId});
   if(p.sourceKind){const src=await s.get(p.sourceKind,p.sourceId,companyId);if(src&&p.sourceKind!=='schedule')await s.put(p.sourceKind,companyId,{...src,status:p.sourceKind==='bank'?'matched':'posted',operationId:op.id,remoteId:receipt.native?src.remoteId:receipt.sourceId,remoteResource:receipt.resource,outstanding:p.sourceKind==='bank'?undefined:src.netPayable??src.amount},src.revision);}
   if(p.relatedId){const invoice=await s.get('invoice',p.relatedId,companyId),bill=await s.get('bill',p.relatedId,companyId);const r=invoice??bill;if(r){const source=await s.get('bank',p.sourceId,companyId),payment=source?minor(source.amount)<0n?-minor(source.amount):minor(source.amount):0n,remaining=minor(r.outstanding??r.netPayable??r.amount)-payment;insist(payment>0n&&remaining>=0n,'Settlement exceeds outstanding amount',409);await s.put('settlement',companyId,{id:op.id+':settlement',relatedId:r.id,side:r.kind,entryId:op.id,date:p.date,amount:money(payment)});await s.put(r.kind,companyId,{...r,status:remaining===0n?'paid':'posted',outstanding:money(remaining),settledBy:op.id},r.revision);}}
   await s.put('operation',companyId,{...op,status:'verified',receipt,verification:checked},op.revision);await s.put('proposal',companyId,{...p,status:'verified',receipt},p.revision);await s.audit(companyId,'operation.verified','system',{operationId:op.id,sourceId:receipt.sourceId,fixture:!!receipt.fixture});
   if(p.autoReverse){const period=nextMonth(periodOf(p.date));await this.createProposal(companyId,{id:p.id+':reversal',date:period+'-01',description:'Reversal · '+p.description,lines:p.lines.map((l:any)=>({accountId:l.accountId,debit:l.credit,credit:l.debit})),evidence:[p.id],questions:[],reason:'Scheduled reversal requiring separate accountant approval',sourceKind:undefined},'system',s);}
  });
 }
 async reconcile(companyId:string,proposalId:string,actor:Actor){
  permit(actor,companyId,['operator','accountant']);const p=await this.store.get('proposal',proposalId,companyId);insist(p?.status==='outcome_unknown','No uncertain outcome to reconcile',409);const op=(await this.store.get('operation','op:'+companyId+':'+proposalId,companyId))!;insist(op.receipt?.sourceId,'No source receipt. Operator must locate and bind source evidence before reconciliation.',409);const c=await this.company(companyId);const result=await this.connector(c).verify(p,op.id,op.receipt);await this.finish(companyId,p,op,op.receipt,result);return this.store.get('proposal',proposalId,companyId);
 }
 async recover(){
  for(const op of (await this.store.list('operation')).filter(o=>o.status==='dispatching')){
   const p=await this.store.get('proposal',op.proposalId,op.companyId),c=await this.company(op.companyId);if(!p)continue;
   if(c.ledger==='native'){try{await this.finish(c.id,p,op,{sourceId:op.id,native:true},{verified:true,recovered:true});continue;}catch{}}
   await this.store.transaction(async s=>{const current=(await s.get('operation',op.id,op.companyId))!;await s.put('operation',op.companyId,{...current,status:'outcome_unknown',error:'Process interrupted after operation admission; reconcile source evidence.'},current.revision);const proposal=(await s.get('proposal',p.id,p.companyId))!;await s.put('proposal',p.companyId,{...proposal,status:'outcome_unknown'},proposal.revision);await s.audit(op.companyId,'operation.recovery_required','system',{operationId:op.id});});
  }
 }
 async updateRuns(companyId:string){
  for(const run of await this.store.list('run',companyId)){if(!['awaiting_review','ready'].includes(run.status))continue;const rows=await Promise.all((run.proposals??[]).map((p:string)=>this.store.get('proposal',p,companyId)));const done=rows.every(p=>p?.status==='verified'||p?.status==='rejected');
   if(done)await this.store.put('run',companyId,{...run,status:'complete',steps:(run.steps??[]).map((s:any)=>({...s,status:'complete'}))},run.revision);}
 }
 async tick(){for(const run of await this.store.list('run'))if(run.status==='queued')await this.prepareRun(run.id).catch(()=>undefined);for(const p of await this.store.list('proposal'))if(p.status==='approved')await this.execute(p.companyId,p.id).catch(async(e:any)=>{await this.store.transaction(async s=>{const current=await s.get('proposal',p.id,p.companyId);if(current?.status==='approved'){await s.put('proposal',p.companyId,{...current,status:'blocked',error:e.message},current.revision);await s.audit(p.companyId,'proposal.execution_blocked','system',{proposalId:p.id,error:e.message});}});});for(const c of await this.store.list('company'))await this.updateRuns(c.id);}
 async closePeriod(companyId:string,period:string,actor:Actor){
  insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(period),'Invalid accounting period');
  permit(actor,companyId,['accountant']);return this.store.transaction(async s=>{
   const c=await s.get('company',companyId);insist(c?.ledger==='native'||c?.mode==='fixture'||c?.sourceSnapshot?.status==='complete','Synchronize and reconcile source books before connected-period sign-off',409);
   const open=(await s.list('proposal',companyId)).filter(p=>p.date.startsWith(period)&&!['verified','rejected','superseded'].includes(p.status));insist(!open.length,'Resolve every proposal before period sign-off',409);
   const banks=(await s.list('bank',companyId)).filter(b=>b.date.startsWith(period)&&b.status!=='matched');insist(!banks.length,'Bank reconciliation has outstanding items',409);
   insist(!(await s.list('bill',companyId)).some(b=>b.date.startsWith(period)&&b.status==='draft'),'Draft bills remain',409);
   const [year,month]=period.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);const r=await reports(s,companyId,last);insist(r.balanced&&r.balanceSheet.difference==='0.00','Reports do not reconcile',409);
   const previous=await s.get('period',companyId+':'+period,companyId);const p=await s.put('period',companyId,{id:companyId+':'+period,status:'locked',scope:c?.ledger==='native'?'native-books':'workspace-sign-off',approvedBy:actor.id,reportDigest:digest(r),sourceSnapshotDigest:c?.sourceSnapshot?.digest,report:r},previous?.revision);await s.put('close_signoff',companyId,{period,approvedBy:actor.id,reportDigest:digest(r),sourceSnapshotDigest:c?.sourceSnapshot?.digest,report:r});await s.audit(companyId,'period.locked',actor.id,{period,scope:p.scope});return p;
  });
 }
 async reverse(companyId:string,entryId:string,date:string,actor:Actor){
  permit(actor,companyId,['operator','accountant']);const e=await this.store.get('entry',entryId,companyId);insist(e,'Entry missing',404);return this.createProposal(companyId,{id:'reverse:'+e.id,date,description:'Reversal · '+e.description,lines:e.lines.map((l:any)=>({accountId:l.accountId,debit:l.credit,credit:l.debit})),evidence:[e.id],questions:[],reason:'Explicit correction through reversing entry'},actor.id);
 }
}

