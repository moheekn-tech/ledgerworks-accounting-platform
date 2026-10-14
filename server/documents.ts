import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from './store.js';
import { amount, day, insist } from './domain.js';
import { recognizeImage, recognizePdfPage, stopOcr } from './ocr.js';
export function extractFields(text:string,method:string,confidence?:number){
 const reference=text.match(/(?:invoice|bill)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,50})/i)?.[1];
 const total=text.match(/(?:grand total|total due|amount due|invoice total)\s*[:₹Rs.INR\s]*([0-9,]+\.[0-9]{2})/i)?.[1]?.replace(/,/g,'');
 const date=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1],gstin=text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/)?.[0];
 return {reference:reference??null,amount:total&&amount.safeParse(total).success?total:null,date:date&&day.safeParse(date).success?date:null,gstin:gstin??null,method,confidence:confidence??null,reviewRequired:true};
}
export async function processDocuments(store:Store,directory:string){
 const eligible=(await store.list('document')).filter(d=>['awaiting-document-worker','queued'].includes(d.processing)||(d.processing==='processing'&&Date.parse(d.leaseUntil??0)<Date.now())).slice(0,1);
 for(const pending of eligible){let d=await store.transaction(async s=>{const current=(await s.get('document',pending.id,pending.companyId))!;if(current.revision!==pending.revision)return undefined;return s.put('document',current.companyId,{...current,processing:'processing',leaseUntil:new Date(Date.now()+10*60000).toISOString(),attempts:(current.attempts??0)+1},current.revision);});if(!d)continue;
  try{const bytes=await readFile(join(directory,'artifacts',d.companyId,d.hash));let text='',method='document-text',confidence:number|undefined,pages=0;
   if(d.mediaType.includes('pdf')||d.name.toLowerCase().endsWith('.pdf')){
    const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs'),loading=pdf.getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const doc=await loading.promise;
    try{const maximum=Number(process.env.DOCUMENT_MAX_PAGES??40);insist(doc.numPages<=maximum,'PDF has more than '+maximum+' pages; split it before processing');pages=doc.numPages;const scores:number[]=[];
     for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();let pageText=content.items.map((i:any)=>i.str??'').join(' ');if(pageText.trim().length<20){const ocr=await recognizePdfPage(page,directory);pageText=ocr.text;scores.push(ocr.confidence);method='pdf-text-and-local-ocr';}text+='\n[Page '+n+']\n'+pageText;page.cleanup();}
     if(scores.length)confidence=scores.reduce((a,b)=>a+b,0)/scores.length;
    }finally{await loading.destroy();}
   }else if(d.mediaType.startsWith('text/')||/\.(txt|csv|json|xml)$/i.test(d.name))text=bytes.toString('utf8');
   else if(d.mediaType.startsWith('image/')||/\.(png|jpe?g|webp|tiff?|bmp)$/i.test(d.name)){const result=await recognizeImage(bytes,directory);text=result.text;confidence=result.confidence;method=result.engine;pages=1;}
   else throw Error('Unsupported format. Upload an image, PDF or text document.');
   insist(text.trim().length,'Document has no recognizable text');const current=(await store.get('document',d.id,d.companyId))!;
   await store.transaction(async s=>{await s.put('document',d!.companyId,{...current,text:text.slice(0,500000),processing:'text-ready',pages,leaseUntil:undefined,extraction:extractFields(text,method,confidence)},current.revision);await s.audit(d!.companyId,'document.processed','document-worker',{documentId:d!.id,method,pages,reviewRequired:true});});
  }catch(e:any){await stopOcr().catch(()=>undefined);const current=(await store.get('document',d.id,d.companyId))!;await store.put('document',d.companyId,{...current,processing:'processing_failed',leaseUntil:undefined,message:e.message},current.revision);await store.audit(d.companyId,'document.processing_failed','document-worker',{documentId:d.id,error:e.message});}
 }
}

