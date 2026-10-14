import assert from 'node:assert/strict';
const base=process.env.APP_URL??'http://127.0.0.1:4310';let cookie='',csrf='';
async function call(path,method='GET',body){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'x-csrf-token':csrf},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();return {r,d};}
let x=await call('/session','POST',{username:'operator',password:'demo'});assert.equal(x.r.status,200);cookie=x.r.headers.get('set-cookie').split(';')[0];csrf=x.d.csrf;
x=await call('/companies/native-demo/workspace');assert.equal(x.r.status,200);assert.ok(x.d.account.length>=20);
x=await call('/companies/native-demo/bills','POST',{vendor:'HTTP smoke supplier',reference:'QA-'+Date.now(),date:'2026-10-14',dueDate:'2026-10-31',amount:'100.00',accountId:'native-demo:5000',memo:'Synthetic verification fixture'});assert.equal(x.r.status,200);const billId=x.d.id;
x=await call('/companies/native-demo/runs','POST',{type:'bills',period:'2026-10'});assert.equal(x.r.status,200);
const runId=x.d.id;for(let n=0;n<20;n++){x=await call('/companies/native-demo/workspace');if(x.d.run.find(r=>r.id===runId)?.status==='awaiting_review')break;await new Promise(r=>setTimeout(r,300));}
const proposals=x.d.proposal.filter(p=>p.sourceId===billId);assert.ok(proposals.length>0);
x=await call('/companies/native-demo/proposals/'+proposals[0].id+'/approve','POST',{revision:proposals[0].revision});assert.equal(x.r.status,403);
x=await call('/session','POST',{username:'accountant',password:'demo'});cookie=x.r.headers.get('set-cookie').split(';')[0];csrf=x.d.csrf;
x=await call('/companies/native-demo/proposals/'+proposals[0].id+'/approve','POST',{revision:proposals[0].revision});assert.equal(x.r.status,200);
for(let n=0;n<20;n++){x=await call('/companies/native-demo/workspace');if(x.d.proposal.find(p=>p.id===proposals[0].id)?.status==='verified')break;await new Promise(r=>setTimeout(r,300));}
assert.equal(x.d.proposal.find(p=>p.id===proposals[0].id).status,'verified');
x=await call('/companies/native-demo/reports?date=2026-10-31');assert.equal(x.d.balanced,true);assert.equal(x.d.balanceSheet.difference,'0.00');
console.log('HTTP smoke passed: authentication, role enforcement, workflow, approval, posting and report reconciliation.');

