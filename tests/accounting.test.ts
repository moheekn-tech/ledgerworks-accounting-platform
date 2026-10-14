import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.js';
import { seed } from '../server/seed.js';
import { Engine } from '../server/engine.js';
import { minor, money, Actor, digest } from '../server/domain.js';
import { reports, consolidate } from '../server/reports.js';
import { tallyVoucher } from '../server/adapters.js';
import { processDocuments } from '../server/documents.js';
import { taxAmounts, taxJournal } from '../server/tax.js';
async function fixture(fn:(e:Engine)=>Promise<void>){const dir=mkdtempSync(join(tmpdir(),'ledgerworks-test-'));const db=await openStore(dir);try{await seed(db.store);await fn(new Engine(db.store));}finally{await db.close();rmSync(dir,{recursive:true,force:true});}}
const actor:Actor={id:'accountant',name:'Accountant',role:'accountant',companyIds:['native-demo','tally-demo','zoho-demo']};
const operator:Actor={...actor,id:'operator',role:'operator'};
test('exact minor-unit amounts round trip and reject floating point admission',()=>{assert.equal(minor('123456789.12'),12345678912n);assert.equal(money(-118n),'-1.18');assert.throws(()=>minor(12.34));assert.throws(()=>minor('12.345'));});
test('all nine workflow / ledger combinations prepare balanced evidence-backed proposals',async()=>fixture(async e=>{
 for(const company of ['native-demo','tally-demo','zoho-demo'])for(const type of ['reconciliation','bills','close']){
  const run=await e.startRun(company,type,'2026-10',operator);await e.prepareRun(run.id);const ready=(await e.store.get('run',run.id))!;assert.equal(ready.status,'awaiting_review');assert.ok(ready.proposals.length);
  for(const pId of ready.proposals){const p=(await e.store.get('proposal',pId))!;assert.equal(p.lines.reduce((n:bigint,l:any)=>n+minor(l.debit)-minor(l.credit),0n),0n);assert.ok(p.evidence.length);}
 }
}));
test('native and fixture connector posting preserves approval and idempotent effect',async()=>fixture(async e=>{
 for(const company of ['native-demo','tally-demo','zoho-demo']){
  const run=await e.startRun(company,'bills','2026-10',operator);await e.prepareRun(run.id);const prepared=(await e.store.get('run',run.id))!;const p=(await e.store.get('proposal',prepared.proposals[0]))!;
  await assert.rejects(()=>e.approve(company,p.id,p.revision,operator),/permission/);
  await assert.rejects(()=>e.execute(company,p.id),/approved/);
  await e.approve(company,p.id,p.revision,actor);await e.execute(company,p.id);await e.execute(company,p.id);
  assert.equal((await e.store.list('entry',company)).filter(x=>x.operationId==='op:'+company+':'+p.id).length,1);
  assert.equal((await e.store.get('proposal',p.id))!.status,'verified');assert.ok((await e.store.list('approval',company)).length);
 }
}));
test('revision changes revoke approval and stale reviews cannot approve',async()=>fixture(async e=>{
 const run=await e.startRun('native-demo','bills','2026-10',operator);await e.prepareRun(run.id);const p=(await e.store.list('proposal','native-demo'))[0];await e.approve('native-demo',p.id,p.revision,actor);
 const approved=(await e.store.get('proposal',p.id))!;await e.editProposal('native-demo',p.id,{date:p.date,description:'Revised accounting description',lines:p.lines,evidence:p.evidence},approved.revision,[],actor);
 await assert.rejects(()=>e.execute('native-demo',p.id),/approved/);await assert.rejects(()=>e.approve('native-demo',p.id,p.revision,actor),/changed/);
}));
test('repeat CSV bytes do not duplicate rows; equal-value distinct rows survive',async()=>fixture(async e=>{
 const csv='date,description,amount\n2026-10-11,Local service,-100.00\n2026-10-11,Local service,-100.00';
 const first=await e.importBank('native-demo',csv,'bank.csv',operator);const second=await e.importBank('native-demo',csv,'again.csv',operator);assert.equal(first.added,2);assert.equal(second.added,0);
}));
test('unbalanced entries and locked periods reject accounting changes',async()=>fixture(async e=>{
 const c='native-demo';await assert.rejects(()=>e.createProposal(c,{date:'2026-10-20',description:'Incorrect journal',lines:[{accountId:c+':1000',debit:'100.00',credit:'0.00'},{accountId:c+':4000',debit:'0.00',credit:'99.99'}],evidence:[]}),/equal/);
 await e.store.put('period',c,{id:c+':2026-11',status:'locked'});await assert.rejects(()=>e.createProposal(c,{date:'2026-11-01',description:'Locked period',lines:[{accountId:c+':1000',debit:'100.00',credit:'0.00'},{accountId:c+':4000',debit:'0.00',credit:'100.00'}],evidence:[]}),/locked/);
}));
test('accrual reversals require separate approval and do not post silently',async()=>fixture(async e=>{
 const r=await e.startRun('native-demo','close','2026-10',operator);await e.prepareRun(r.id);const p=(await e.store.list('proposal','native-demo'))[0];await e.approve('native-demo',p.id,p.revision,actor);await e.execute('native-demo',p.id);
 const reversal=(await e.store.get('proposal',p.id+':reversal'))!;assert.equal(reversal.status,'ready_for_review');assert.equal(reversal.date,'2026-11-01');assert.equal(reversal.lines[0].credit,'12000.00');
}));
test('reports and group balances reconcile across verified sample entities',async()=>fixture(async e=>{
 const r=await reports(e.store,'native-demo','2026-10-31');assert.equal(r.profitLoss.revenue,'85000.00');assert.equal(r.balanceSheet.difference,'0.00');assert.equal(r.balanced,true);
 const group=await consolidate(e.store,['native-demo','tally-demo','zoho-demo'],'2026-10-31',{});assert.equal(group.trialBalance.reduce((n:bigint,a:any)=>n+minor(a.net),0n),0n);
}));
test('source mutation prevents stale approved effect and source cannot be allocated twice',async()=>fixture(async e=>{
 const r=await e.startRun('native-demo','bills','2026-10',operator);await e.prepareRun(r.id);const p=(await e.store.list('proposal','native-demo'))[0];await e.approve('native-demo',p.id,p.revision,actor);
 const bill=(await e.store.get('bill',p.sourceId))!;await e.store.put('bill','native-demo',{...bill,amount:'9999.00'},bill.revision);await assert.rejects(()=>e.execute('native-demo',p.id),/Source changed/);
}));
test('Tally import escapes source text and preserves debit / credit direction',()=>{
 const company:any={profile:{companyName:'A & B',accountMap:{bank:'Bank <Main>',expense:'Software'}}};
 const xml=tallyVoucher(company,{date:'2026-10-01',description:'Invoice <unsafe>',lines:[{accountId:'expense',debit:'100.00',credit:'0.00'},{accountId:'bank',debit:'0.00',credit:'100.00'}]} as any,'operation-1');
 assert.ok(xml.includes('A &amp; B'));assert.ok(xml.includes('Bank &lt;Main&gt;'));assert.ok(xml.includes('<AMOUNT>-100.00</AMOUNT>'));assert.ok(xml.includes('<AMOUNT>100.00</AMOUNT>'));
});
test('recurring schedules post across periods and conserve every minor unit',async()=>fixture(async e=>{
 const c='native-demo';await e.store.put('schedule',c,{id:'three-month-prepaid',name:'Three-month service',type:'prepaid',amount:'100.00',startDate:'2026-10-01',months:3,accountId:c+':5000',offsetAccountId:c+':1200',evidence:['contract'],status:'active'});
 const allocated:string[]=[];for(const period of ['2026-10','2026-11','2026-12']){const run=await e.startRun(c,'schedules',period,operator);await e.prepareRun(run.id);const p=(await e.store.list('proposal',c)).find(p=>p.runId===run.id&&p.sourceId==='three-month-prepaid')!;allocated.push(p.lines[0].debit);await e.approve(c,p.id,p.revision,actor);await e.execute(c,p.id);}
 assert.deepEqual(allocated,['33.33','33.33','33.34']);assert.equal(allocated.reduce((n,a)=>n+minor(a),0n),10000n);
}));
test('draft bill payment waits for bill posting and debits payables',async()=>fixture(async e=>{
 const c='native-demo';await e.importBank(c,'date,description,amount\n2026-10-12,Cloudstack CL-2026-10,-5900.00','bill-payment.csv',operator);const run=await e.startRun(c,'reconciliation','2026-10',operator);await e.prepareRun(run.id);const p=(await e.store.list('proposal',c)).find(p=>p.description==='Cloudstack CL-2026-10')!;
 assert.equal(p.status,'needs_input');assert.equal(p.lines[0].accountId,c+':2000');await e.editProposal(c,p.id,p,p.revision,['Bill will be prepared first'],actor);const ready=(await e.store.get('proposal',p.id))!;await e.approve(c,p.id,ready.revision,actor);await assert.rejects(()=>e.execute(c,p.id),/must be posted/);
}));
test('unknown external effects cannot be blindly redispatched',async()=>fixture(async e=>{
 const c='zoho-demo',company=(await e.store.get('company',c))!;await e.store.put('company',c,{...company,mode:'live',profile:{accountMap:{[c+':5000']:'expense',[c+':2100']:'accrued'}}},company.revision);const p=await e.createProposal(c,{date:'2026-10-12',description:'Manual adjusting journal',lines:[{accountId:c+':5000',debit:'100.00',credit:'0.00'},{accountId:c+':2100',debit:'0.00',credit:'100.00'}],evidence:[]});await e.approve(c,p.id,p.revision,actor);await assert.rejects(()=>e.execute(c,p.id));await assert.rejects(()=>e.execute(c,p.id),/approved/);const op=(await e.store.list('operation',c))[0];assert.equal(op.attempts,1);assert.equal(op.status,'outcome_unknown');assert.equal((await e.store.list('entry',c)).filter(x=>x.id===op.id).length,0);
}));
test('restart recovers an admitted native operation exactly once',async()=>fixture(async e=>{
 const c='native-demo',run=await e.startRun(c,'bills','2026-10',operator);await e.prepareRun(run.id);let p=(await e.store.list('proposal',c))[0];await e.approve(c,p.id,p.revision,actor);p=(await e.store.get('proposal',p.id))!;const opId='op:'+c+':'+p.id;await e.store.put('operation',c,{id:opId,proposalId:p.id,payloadDigest:p.payloadDigest,status:'dispatching',attempts:1});await e.store.put('proposal',c,{...p,status:'dispatching'},p.revision);await e.recover();await e.recover();assert.equal((await e.store.get('proposal',p.id))!.status,'verified');assert.equal((await e.store.list('entry',c)).filter(x=>x.id===opId).length,1);
}));
test('monthly budgets exclude expenses from earlier months',async()=>fixture(async e=>{
 const c='native-demo';await e.store.put('entry',c,{date:'2026-09-30',description:'Earlier month',verified:true,lines:[{accountId:c+':5000',debit:'1000.00',credit:'0.00'},{accountId:c+':1000',debit:'0.00',credit:'1000.00'}]});const r=await reports(e.store,c,'2026-10-31');assert.equal(r.variance.find((v:any)=>v.accountId===c+':5000').actual,'0.00');
}));
test('text extraction retains review-required values without posting',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledgerworks-document-'));const db=await openStore(dir);try{await seed(db.store);const c='native-demo',hash='a'.repeat(64);mkdirSync(join(dir,'artifacts',c),{recursive:true});writeFileSync(join(dir,'artifacts',c,hash),'Invoice # AC-2026-10\nDate 2026-10-12\nGrand total INR 1,180.00');const doc=await db.store.put('document',c,{name:'invoice.txt',mediaType:'text/plain',hash,processing:'queued'});await processDocuments(db.store,dir);const processed=(await db.store.get('document',doc.id))!;assert.equal(processed.processing,'text-ready');assert.equal(processed.extraction.amount,'1180.00');assert.equal(processed.extraction.reviewRequired,true);assert.equal((await db.store.list('proposal',c)).length,0);}finally{await db.close();rmSync(dir,{recursive:true,force:true});}
});
test('configured GST and TDS conserve gross value and distinguish ITC',()=>{
 const tax=taxAmounts({base:'1000.00',rate:'18.00',supply:'intra',eligible:true,tds:'50.00'});assert.equal(tax.gross,'1180.00');assert.equal(tax.cgst,'90.00');assert.equal(tax.netPayable,'1130.00');const lines=taxJournal('native-demo','native-demo:5000','native-demo:2000',tax);assert.equal(lines.reduce((s,l)=>s+minor(l.debit)-minor(l.credit),0n),0n);assert.equal(lines.find(l=>l.accountId.endsWith(':2500')).credit,'50.00');const noITC=taxJournal('native-demo','native-demo:5000','native-demo:2000',taxAmounts({...tax,eligible:false}));assert.equal(noITC[0].debit,'1180.00');assert.equal(noITC.some(l=>l.accountId.endsWith(':1501')),false);
});
test('complete bills, bank reconciliation and close conserve books across all three source modes',async()=>fixture(async e=>{
 for(const c of ['native-demo','tally-demo','zoho-demo']){
  await e.store.put('account',c,{id:c+':1001',code:'1001',name:'Business savings bank',type:'asset'});
  const bills=await e.startRun(c,'bills','2026-10',operator);await e.prepareRun(bills.id);for(const p of (await e.store.list('proposal',c)).filter(p=>p.runId===bills.id)){await e.approve(c,p.id,p.revision,actor);await e.execute(c,p.id);}
  const bank=await e.startRun(c,'reconciliation','2026-10',operator);await e.prepareRun(bank.id);for(const p of (await e.store.list('proposal',c)).filter(p=>p.runId===bank.id)){
   const lines=p.lines.map((l:any)=>({...l}));if(p.description.includes('Ravi'))lines[0].accountId=c+':5100';if(p.description.includes('savings'))lines[0].accountId=c+':1001';const edited=await e.editProposal(c,p.id,{...p,lines},p.revision,(p.questions??[]).map(()=> 'Confirmed from synthetic source evidence for this accounting case'),actor);await e.approve(c,p.id,edited.revision,actor);await e.execute(c,p.id);
  }
  const close=await e.startRun(c,'close','2026-10',operator);await e.prepareRun(close.id);for(const p of (await e.store.list('proposal',c)).filter(p=>p.runId===close.id)){await e.approve(c,p.id,p.revision,actor);await e.execute(c,p.id);}
  const locked=await e.closePeriod(c,'2026-10',actor),r=await reports(e.store,c,'2026-10-31');assert.equal(locked.status,'locked');assert.equal(r.bank.unresolved,0);assert.equal(r.balanceSheet.difference,'0.00');assert.equal(r.profitLoss.expenses,'45518.00');assert.equal((await e.store.get('bill',c+':billa'))!.status,'paid');assert.equal((await e.store.get('invoice',c+':invoice104'))!.status,'paid');
 }
}));

