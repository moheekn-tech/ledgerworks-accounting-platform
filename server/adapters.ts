import { Row, insist } from './domain.js';
import { ZohoConnector } from './connectors/zoho.js';
import { TallyConnector, tallyPlan, xml } from './connectors/tally.js';
import { zohoPlan } from './connectors/plans.js';
import { Transport } from './connectors/http.js';
export { xml };
export function tallyVoucher(company:Row,proposal:Row,operationId:string){return tallyPlan(company,proposal,undefined,undefined,operationId).payload;}
export type ConnectorOptions={transport?:Transport;checkpoint?:(receipt:any)=>Promise<void>};
export type SyncResult={accounts:any[];entries:any[];contacts:any[];bills:any[];invoices:any[];bank:any[];coverage:string;snapshot:any;message:string};
export class Connector {
 private source:ZohoConnector|TallyConnector;
 constructor(public company:Row,options:ConnectorOptions={}){this.source=company.ledger==='zoho'?new ZohoConnector(company,options.transport,options.checkpoint):new TallyConnector(company,options.transport,options.checkpoint);}
 get fixture(){return this.company.mode==='fixture';}
 plan(proposal:Row,source?:Row,related?:Row){if(this.company.mode!=='live')return undefined;return this.company.ledger==='zoho'?zohoPlan(this.company,proposal,source,related):tallyPlan(this.company,proposal,source,related);}
 async sync():Promise<SyncResult>{if(this.fixture||this.company.ledger==='native')return {accounts:[],entries:[],contacts:[],bills:[],invoices:[],bank:[],coverage:this.fixture?'synthetic-fixture':'native-local',snapshot:{status:'complete',fixture:this.fixture},message:this.fixture?'Synthetic fixture connector':'Native books are local authority'};return this.source.sync();}
 async dispatch(proposal:Row,operationId:string){if(this.fixture)return {sourceId:'fixture:'+operationId,fixture:true,resource:proposal.sourceKind??'journal'};insist(process.env.ALLOW_LIVE_WRITES==='true','Live connector writes are disabled',403);return this.source.dispatch(proposal,operationId);}
 async verify(proposal:Row,operationId:string,receipt:any){if(this.fixture){insist(receipt.sourceId==='fixture:'+operationId,'Fixture receipt differs from operation identity',409);return {verified:true,fixture:true,sourceId:receipt.sourceId};}return this.source.verify(proposal,operationId,receipt);}
}

