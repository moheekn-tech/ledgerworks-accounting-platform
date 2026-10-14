import { readFileSync } from 'node:fs';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Actor, insist } from './domain.js';
import {TOTP,Secret} from 'otpauth';
const schema=z.array(z.object({id:z.string().min(1),name:z.string().min(1),role:z.enum(['operator','accountant','owner']),companyIds:z.array(z.string()),salt:z.string().regex(/^[a-f0-9]{32}$/),passwordHash:z.string().regex(/^[a-f0-9]{64}$/),totpSecret:z.string().regex(/^[A-Z2-7]+$/).optional(),disabled:z.boolean().default(false)}));
export function authUsers(){return process.env.AUTH_USERS_FILE?schema.parse(JSON.parse(readFileSync(process.env.AUTH_USERS_FILE,'utf8'))):undefined;}
export function configuredActor(id:string):Actor {const u=authUsers()?.find(u=>u.id===id&&!u.disabled);insist(u,'Account is disabled or unavailable',401);return {id:u.id,name:u.name,role:u.role,companyIds:u.companyIds};}
export function authenticateConfigured(username:string,password:string,otp?:string):Actor {const users=authUsers()!;const u=users.find(u=>u.id===username&&!u.disabled);const candidate=scryptSync(password,u?.salt??'00000000000000000000000000000000',32);insist(u&&timingSafeEqual(candidate,Buffer.from(u.passwordHash,'hex')),'Invalid credentials',401);if((u as any).totpSecret){const totp=new TOTP({issuer:'Ledgerworks',label:u.id,secret:Secret.fromBase32((u as any).totpSecret)});insist(otp&&totp.validate({token:otp,window:1})!==null,'Invalid authentication code',401);}return configuredActor(u.id);}
