import { Store } from './store.js';
import { digest } from './domain.js';
export const accounts = [
 ['1000','Operating bank','asset'],['1100','Accounts receivable','asset'],['1200','Prepaid expenses','asset'],['1300','Fixed assets','asset'],['1390','Accumulated depreciation','asset'],['1400','Inventory','asset'],
 ['1501','Input CGST','asset'],['1502','Input SGST','asset'],['1503','Input IGST','asset'],['2401','Output CGST','liability'],['2402','Output SGST','liability'],['2403','Output IGST','liability'],['2500','TDS payable','liability'],['2000','Accounts payable','liability'],['2100','Accrued expenses','liability'],['2200','Deferred revenue','liability'],['2300','Debt payable','liability'],
 ['3000','Owner equity','equity'],['4000','Service revenue','revenue'],['5000','Software and subscriptions','expense'],['5100','Professional fees','expense'],['5200','Rent','expense'],['5300','Payroll','expense'],['5400','Bank charges','expense'],['5500','Depreciation','expense'],['5600','Cost of goods sold','expense'],['5700','Interest expense','expense'],['5800','Stock compensation','expense'],['5900','Other operating expenses','expense']
];
export async function seed(store:Store) {
 if ((await store.list('company')).length) return;
 await store.transaction(async s=>{
   for(const [companyId,name,ledger] of [['native-demo','Forma Studio','native'],['tally-demo','Kaveri Trading','tally'],['zoho-demo','Northstar Services','zoho']]){
     await s.put('company',companyId,{id:companyId,name,ledger,currency:'INR',mode:ledger==='native'?'native':'fixture',period:'2026-10',profile:{},policyVersion:1});
     for(const [code,label,type] of accounts) await s.put('account',companyId,{id:companyId+':'+code,code,name:label,type,sourceId:code});
     await s.put('entry',companyId,{id:companyId+':opening',date:'2026-10-01',description:'Opening capital',operationId:companyId+':opening',lines:[{accountId:companyId+':1000',debit:'400000.00',credit:'0.00'},{accountId:companyId+':3000',debit:'0.00',credit:'400000.00'}],verified:true,evidence:['synthetic-opening'],origin:'fixture'});
     await s.put('entry',companyId,{id:companyId+':sales',date:'2026-10-04',description:'Invoice INV-104 · Alder Design',operationId:companyId+':sales',lines:[{accountId:companyId+':1100',debit:'85000.00',credit:'0.00'},{accountId:companyId+':4000',debit:'0.00',credit:'85000.00'}],verified:true,evidence:['synthetic-invoice'],origin:'fixture'});
     await s.put('invoice',companyId,{id:companyId+':invoice104',customer:'Alder Design',reference:'INV-104',date:'2026-10-04',dueDate:'2026-10-20',amount:'85000.00',status:'posted',sourceId:'INV-104'});
     const rows=[['2026-10-05','Client payment INV-104 Alder Design','85000.00'],['2026-10-07','Monthly cloud software subscription','-5900.00'],['2026-10-09','UPI payment to Ravi','-12500.00'],['2026-10-10','Bank service charges','-118.00'],['2026-10-10','Transfer to business savings','-25000.00']];
     for(let i=0;i<rows.length;i++){const [date,description,amount]=rows[i];await s.put('bank',companyId,{id:companyId+':bank'+i,date,description,amount,sourceId:'BANK-'+i,status:'unreviewed',fingerprint:digest({date,description,amount}),evidence:['demo-bank-statement'],origin:'fixture'});}
     for(const [i,vendor,reference,amount,account] of [['a','Cloudstack','CL-2026-10','5900.00','5000'],['b','Kumar Legal','KL-108','15000.00','5100']]) await s.put('bill',companyId,{id:companyId+':bill'+i,vendor,reference,date:'2026-10-07',dueDate:'2026-10-22',amount,accountId:companyId+':'+account,memo:'Synthetic fixture document',status:'draft',evidence:['demo-bill-'+i]});
     await s.put('schedule',companyId,{id:companyId+':accrual',name:'October contract services',type:'accrual',amount:'12000.00',startDate:'2026-10-01',months:1,accountId:companyId+':5100',offsetAccountId:companyId+':2100',autoReverse:true,evidence:['synthetic-approved-accrual-method'],status:'active'});
     await s.put('budget',companyId,{id:companyId+':budget',period:'2026-10',lines:[{accountId:companyId+':4000',amount:'100000.00'},{accountId:companyId+':5100',amount:'20000.00'},{accountId:companyId+':5000',amount:'6000.00'},{accountId:companyId+':5200',amount:'25000.00'}]});
     await s.audit(companyId,'company.seeded','system',{synthetic:true,ledger});
   }
 });
}

