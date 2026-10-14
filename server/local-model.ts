import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Row,insist} from './domain.js';
let classifier:Promise<any>|undefined;
export async function localCoding(description:string,accounts:Row[]){
 if(!classifier)classifier=(async()=>{const {pipeline,env}=await import('@huggingface/transformers');env.cacheDir=resolve(process.env.DATA_DIR??'data','models');mkdirSync(env.cacheDir,{recursive:true});return pipeline('zero-shot-classification',process.env.LOCAL_MODEL??'Xenova/distilbert-base-uncased-mnli',{dtype:'q8',device:'cpu'});})().catch(e=>{classifier=undefined;throw e;});
 const labels=accounts.map(a=>a.name);insist(labels.length>0,'No accounting categories provided');
 const result=await (await classifier)(description.slice(0,3000),labels,{hypothesis_template:'This business transaction is an expense for {}.'});
 const account=accounts.find(a=>a.name===result.labels[0])!,score=result.scores[0];
 return {accountId:account.id,reason:'Local model category proposal: '+account.name+'; relative score '+score.toFixed(3)+'. Accountant approval required.',questions:score<0.55?['Confirm the transaction purpose and selected account; the model category is uncertain.']:[],method:'local-model',model:process.env.LOCAL_MODEL??'Xenova/distilbert-base-uncased-mnli'};
}
