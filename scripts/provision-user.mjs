import {randomBytes,scryptSync} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const password=process.env.PROVISION_PASSWORD??'';if(password.length<12)throw Error('Use a password of at least 12 characters.');
const path=resolve(process.env.AUTH_USERS_FILE??'data/auth-users.json');mkdirSync(dirname(path),{recursive:true});const users=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):[];
const id=process.env.PROVISION_ID,role=process.env.PROVISION_ROLE;if(!id||!['operator','accountant','owner'].includes(role))throw Error('Username and role are required.');
if(users.some(u=>u.id===id))throw Error('User already exists; update its access or disable it in the users file.');
const salt=randomBytes(16).toString('hex');users.push({id,name:process.env.PROVISION_NAME??id,role,companyIds:JSON.parse(process.env.PROVISION_COMPANIES??'[]'),salt,passwordHash:scryptSync(password,salt,32).toString('hex'),disabled:false});writeFileSync(path,JSON.stringify(users,null,2),{mode:0o600});console.log('User created. Configure AUTH_USERS_FILE to '+path);
