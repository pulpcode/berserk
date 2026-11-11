/** Separate B budget; never borrows C's allocation and never retries a started request. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {save} from './source-runtime.js';
export const budgets={requests:96,input:2_000_000,output:60_000};
export const trialReserve={requests:8,input:150_000,output:8192};
export interface RequestUsage {inputTokens:number;outputTokens:number;responseModel:string}
interface Row {id:string;trialId:string;status:'started'|'finished'|'failed';usage?:RequestUsage;reason?:string}
interface Data {freezeHash:string;requests:Row[];halted?:string}
export class SourceLedger {
 constructor(readonly path:string,readonly freezeHash:string){assert.ok(!existsSync(path),'Refuse reusing an existing B ledger');save(path,{freezeHash,requests:[]});}
 read(){const d=JSON.parse(readFileSync(this.path,'utf8')) as Data;assert.equal(d.freezeHash,this.freezeHash);return d;}
 totals(){const rs=this.read().requests;return {requests:rs.length,input:rs.reduce((n,r)=>n+(r.usage?.inputTokens??0),0),output:rs.reduce((n,r)=>n+(r.usage?.outputTokens??0),0),unknown:rs.filter(r=>r.status!=='finished').length};}
 canStartTrial(){const d=this.read(),t=this.totals();return !d.halted&&!t.unknown&&(['requests','input','output'] as const).every(k=>t[k]+trialReserve[k]<=budgets[k]);}
 assertRequest(inputReserve:number){const d=this.read(),t=this.totals();assert.ok(!d.halted&&!t.unknown,'B ledger halted/unknown usage');assert.ok(t.requests+1<=budgets.requests&&t.input+inputReserve<=budgets.input&&t.output+8192<=budgets.output,'B authorized budget exhausted');}
 beginRequest(id:string,trialId:string){const d=this.read();assert.ok(!d.halted&&!d.requests.some(r=>r.status!=='finished'||r.id===id));d.requests.push({id,trialId,status:'started'});save(this.path,d);}
 finishRequest(id:string,usage:RequestUsage){const d=this.read(),r=d.requests.find(x=>x.id===id);assert.equal(r?.status,'started');assert.ok(Number.isSafeInteger(usage.inputTokens)&&usage.inputTokens>=0&&Number.isSafeInteger(usage.outputTokens)&&usage.outputTokens>=0);assert.equal(usage.responseModel,'deepseek-v4-1-flash-261017');r!.status='finished';r!.usage=usage;save(this.path,d);const t=this.totals();if(t.requests>budgets.requests||t.input>budgets.input||t.output>budgets.output)this.halt('provider_usage_exceeded_reserved_budget');}
 failRequest(id:string,reason:string){const d=this.read(),r=d.requests.find(x=>x.id===id);assert.ok(r);r.status='failed';r.reason=reason;d.halted??=reason;save(this.path,d);}
 halt(reason:string){const d=this.read();d.halted??=reason;save(this.path,d);}
}
