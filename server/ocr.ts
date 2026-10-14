import {createWorker,Worker} from 'tesseract.js';
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {insist} from './domain.js';
let worker:Worker|undefined,initializing:Promise<Worker>|undefined;
async function getWorker(directory:string){if(worker)return worker;if(initializing)return initializing;const languages=process.env.OCR_LANGUAGES??'eng';insist(/^[a-z]{3}(\+[a-z]{3})*$/.test(languages),'Invalid OCR language configuration');const cachePath=join(directory,'ocr-cache');mkdirSync(cachePath,{recursive:true});initializing=createWorker(languages,1,{cachePath,...(process.env.OCR_LANG_PATH?{langPath:process.env.OCR_LANG_PATH}:{}),logger:()=>undefined}).then(w=>{worker=w;return w;}).finally(()=>{initializing=undefined;});return initializing;}
export async function recognizeImage(bytes:Uint8Array,directory:string){const w=await getWorker(directory);const result=await Promise.race([w.recognize(Buffer.from(bytes)),new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(Error('OCR recognition exceeded 90 seconds')),90000);t.unref();})]);return {text:result.data.text,confidence:result.data.confidence,engine:'tesseract-local'};}
export async function recognizePdfPage(page:any,directory:string){const viewport=page.getViewport({scale:2}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));insist(canvas.width*canvas.height<=30000000,'PDF page exceeds OCR raster size limit');const context=canvas.getContext('2d');await page.render({canvas:canvas as any,canvasContext:context as any,viewport}).promise;return recognizeImage(canvas.toBuffer('image/png'),directory);}
export async function stopOcr(){if(worker){await worker.terminate();worker=undefined;}}
