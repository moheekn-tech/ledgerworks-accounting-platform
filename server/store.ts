import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Row, DomainError, id } from './domain.js';
type Sql = (sql: string, params?: any[]) => Promise<any[]>;
export class Store {
  constructor(private sql: Sql, private transact: <T>(fn: (s: Store) => Promise<T>) => Promise<T>) {}
  async get(kind: string, rowId: string, companyId?: string): Promise<Row | undefined> { const rows = await this.sql('SELECT payload FROM records WHERE kind=? AND id=?' + (companyId ? ' AND company_id=?' : ''), companyId ? [kind,rowId,companyId] : [kind,rowId]); return rows[0] ? JSON.parse(rows[0].payload) : undefined; }
  async list(kind: string, companyId?: string): Promise<Row[]> { const rows = await this.sql('SELECT payload FROM records WHERE kind=?' + (companyId ? ' AND company_id=?' : '') + ' ORDER BY created_at,id', companyId ? [kind,companyId] : [kind]); return rows.map(r => JSON.parse(r.payload)); }
  async put(kind: string, companyId: string, data: any, expectedRevision?: number): Promise<Row> {
    const rowId = data.id ?? id(); const now = new Date().toISOString();
    const previous = await this.get(kind,rowId,companyId);
    if (previous && ['audit','approval','entry','settlement','close_signoff','filing_approval','filing_receipt'].includes(kind)) throw new DomainError(409,'Immutable record already exists');
    if (previous && expectedRevision !== previous.revision) throw new DomainError(409,'Record changed. Refresh before retrying.');
    const row: Row = {...data,id:rowId,companyId,kind,revision:(previous?.revision ?? 0)+1,createdAt:previous?.createdAt ?? now,updatedAt:now};
    if (previous) {
      const result = await this.sql('UPDATE records SET revision=?,payload=? WHERE kind=? AND id=? AND company_id=? AND revision=? RETURNING id',[row.revision,JSON.stringify(row),kind,rowId,companyId,expectedRevision]);
      if (!result.length) throw new DomainError(409,'Concurrent update; refresh the record');
    } else {
      try { await this.sql('INSERT INTO records(kind,id,company_id,revision,payload,created_at) VALUES(?,?,?,?,?,?) RETURNING id',[kind,rowId,companyId,row.revision,JSON.stringify(row),now]); } catch (e: any) { throw new DomainError(409,'Duplicate record identity'); }
    }
    return row;
  }
  async audit(companyId: string, event: string, actorId: string, detail: any) { return this.put('audit',companyId,{event,actorId,detail}); }
  async transaction<T>(fn: (s: Store) => Promise<T>): Promise<T> { return this.transact(fn); }
  async kinds():Promise<string[]>{return (await this.sql('SELECT DISTINCT kind FROM records ORDER BY kind')).map(r=>r.kind);}
  async count():Promise<number>{return Number((await this.sql('SELECT COUNT(*) AS count FROM records'))[0].count);}
  async restore(rows:Row[]){return this.transaction(async s=>{if(await s.count())throw new DomainError(409,'Restore target is not empty');for(const r of rows)await s.sql('INSERT INTO records(kind,id,company_id,revision,payload,created_at) VALUES(?,?,?,?,?,?)',[r.kind,r.id,r.companyId,r.revision,JSON.stringify(r),r.createdAt]);});}
}
export async function openStore(directory: string, databaseUrl?: string) {
  mkdirSync(directory,{recursive:true}); const schema = 'CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,company_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS records_company_kind ON records(company_id,kind);';
  if (databaseUrl) {
    const pool = new pg.Pool({connectionString:databaseUrl}); await pool.query(schema);
    const query = async (q:string,p:any[]=[]) => { let i=0; return (await pool.query(q.replace(/\?/g,()=>'$'+(++i)),p)).rows; };
    const store = new Store(query,async fn => { const client=await pool.connect(); try { await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); const s:Store=new Store(async(q,p=[])=>{let i=0; return (await client.query(q.replace(/\?/g,()=>'$'+(++i)),p)).rows;},async nested=>nested(s)); const result=await fn(s); await client.query('COMMIT'); return result; } catch(e) {await client.query('ROLLBACK'); throw e;} finally {client.release();} });
    return {store, close:()=>pool.end(),driver:'postgresql'};
  }
  const db = new DatabaseSync(join(directory,'ledger.sqlite')); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;'+schema);
  const query:Sql=async(q,p=[])=>db.prepare(q).all(...p); let queue=Promise.resolve();
  const queued:Sql=(q,p=[])=>{const job=queue.then(()=>query(q,p));queue=job.then(()=>undefined,()=>undefined);return job;};
  const store = new Store(queued,fn => { const job=queue.then(async()=>{db.exec('BEGIN IMMEDIATE'); const s:Store=new Store(query,async nested=>nested(s)); try {const result=await fn(s); db.exec('COMMIT'); return result;} catch(e){db.exec('ROLLBACK');throw e;}}); queue=job.then(()=>undefined,()=>undefined); return job; });
  return {store,close:async()=>db.close(),driver:'sqlite-local'};
}

