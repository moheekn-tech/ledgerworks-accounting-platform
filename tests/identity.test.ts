import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scryptSync} from 'node:crypto';
import {authenticateConfigured,configuredActor} from '../server/identity.js';
import {permit} from '../server/domain.js';
test('configured identities enforce passwords, company scope and immediate revocation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledgerworks-identity-')),path=join(dir,'users.json'),previous=process.env.AUTH_USERS_FILE,salt='a'.repeat(32);const user={id:'test-accountant',name:'Test accountant',role:'accountant',companyIds:['company-a'],salt,passwordHash:scryptSync('synthetic-password',salt,32).toString('hex'),disabled:false};
 try{writeFileSync(path,JSON.stringify([user]));process.env.AUTH_USERS_FILE=path;const actor=authenticateConfigured(user.id,'synthetic-password');assert.equal(actor.role,'accountant');assert.throws(()=>authenticateConfigured(user.id,'wrong'),/Invalid credentials/);assert.throws(()=>permit(actor,'company-b'),/permission/);writeFileSync(path,JSON.stringify([{...user,disabled:true}]));assert.throws(()=>configuredActor(user.id),/disabled/);}finally{if(previous===undefined)delete process.env.AUTH_USERS_FILE;else process.env.AUTH_USERS_FILE=previous;rmSync(dir,{recursive:true,force:true});}
});
