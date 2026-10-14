import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
export type Role = 'operator' | 'accountant' | 'owner';
export type Actor = { id: string; name: string; role: Role; companyIds: string[] };
export type Row = { id: string; companyId: string; kind: string; revision: number; createdAt: string; updatedAt: string; [key: string]: any };
export class DomainError extends Error { constructor(public status: number, message: string) { super(message); } }
export function insist(ok: unknown, message: string, status = 422): asserts ok { if (!ok) throw new DomainError(status, message); }
export const id = () => randomUUID();
export function stable(value: any): string { if(value===undefined)return 'null';if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'; return JSON.stringify(value); }
export const digest = (value: any) => createHash('sha256').update(stable(value)).digest('hex');
export function effectDigest(p:any){return digest({date:p.date,description:p.description,lines:p.lines,evidence:p.evidence??[],sourceKind:p.sourceKind??null,sourceId:p.sourceId??null,sourceRevision:p.sourceRevision??null,relatedId:p.relatedId??null,relatedRevision:p.relatedRevision??null,companyRevision:p.companyRevision,policyVersion:p.policyVersion,sourceMode:p.sourceMode,writePlan:p.writePlan??null,autoReverse:p.autoReverse??false,scheduleId:p.scheduleId??null});}
export function minor(value: unknown): bigint {
  insist(typeof value === 'string' && /^-?\d{1,13}(\.\d{1,2})?$/.test(value), 'Amount must be an exact decimal string with at most two fractional digits');
  const negative = value.startsWith('-'); const parts = value.replace('-', '').split('.');
  return (BigInt(parts[0]) * 100n + BigInt((parts[1] ?? '').padEnd(2, '0'))) * (negative ? -1n : 1n);
}
export function money(value: bigint): string { const n = value < 0n ? -value : value; return (value < 0n ? '-' : '') + (n / 100n).toString() + '.' + (n % 100n).toString().padStart(2, '0'); }
export function sum(values: string[]): string { return money(values.reduce((a, v) => a + minor(v), 0n)); }
export const amount = z.string().refine(v => { try { minor(v); return true; } catch { return false; } }, 'Use decimal strings, e.g. 1200.00');
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Invalid date');
export const lineSchema = z.object({ accountId: z.string().min(1), debit: amount, credit: amount });
export const proposalInput = z.object({ date: day, description: z.string().min(3).max(500), lines: z.array(lineSchema).min(2).max(100), evidence: z.array(z.string()).default([]) });
export const billInput = z.object({ vendor: z.string().min(1).max(200), reference: z.string().min(1).max(100), date: day, dueDate: day, amount, accountId: z.string().optional(), memo: z.string().max(2000).default(''), documentId: z.string().optional(),tax:z.object({base:amount,rate:amount,supply:z.enum(['intra','inter']),eligible:z.boolean().default(true),tds:amount.default('0.00')}).optional() });
export const scheduleInput = z.object({ name: z.string().min(1), type: z.enum(['prepaid','asset','accrual','payroll','lease','interest','stock_compensation','inventory','revenue']), amount, startDate: day, months: z.number().int().min(1).max(600), accountId: z.string(), offsetAccountId: z.string(), autoReverse: z.boolean().default(false), evidence: z.array(z.string()).default([]) });
export function permit(actor: Actor, companyId: string, roles: Role[] = ['operator','accountant','owner']) { insist(actor.companyIds.includes(companyId) && roles.includes(actor.role), 'You do not have permission for this company or action', 403); }
export function periodOf(date: string) { return date.slice(0,7); }
export function nextMonth(period: string) { const [y,m] = period.split('-').map(Number); return new Date(Date.UTC(y,m,1)).toISOString().slice(0,7); }

