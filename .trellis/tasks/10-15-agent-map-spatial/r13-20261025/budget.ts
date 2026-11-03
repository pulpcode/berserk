/** R13 shared budget. A progressing task has no per-task numeric cutoff. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
export const limits={requests:96,input:2_500_000,output:400_000} as const;
export const pairReserve={requests:24,input:600_000,output:131_072} as const;
export const maxTokens=32768;
export const responseModel='deepseek-v4-1-flash-261017';
export interface Usage {input:number;output:number}
interface RequestRow {id:number;trialId:string;status:'started'|'finished'|'failed';inputReserve:number;usage?:Usage;reason?:string}
interface Data {freezeHash:string;requests:RequestRow[];halted?:string}
export class Ledger {
 constructor(readonly path:string,readonly freezeHash:string){assert.ok(!existsSync(path),'Refuse reusing ledger');this.write({freezeHash,requests:[]});}
 private write(data:Data){writeFileSync(this.path+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(this.path+'.tmp',this.path);}
 read():Data{const d=JSON.parse(readFileSync(this.path,'utf8')) as Data;assert.equal(d.freezeHash,this.freezeHash);return d;}
 totals(){const d=this.read();return {requests:d.requests.length,input:d.requests.reduce((n,r)=>n+(r.usage?.input??0),0),output:d.requests.reduce((n,r)=>n+(r.usage?.output??0),0),unknown:d.requests.filter(r=>!r.usage).length};}
 canStartPair(){const d=this.read(),t=this.totals();return !d.halted&&!t.unknown&&(['requests','input','output'] as const).every(k=>t[k]+pairReserve[k]<limits[k]);}
 assertRequest(inputReserve:number){assert.ok(Number.isSafeInteger(inputReserve)&&inputReserve>0);const d=this.read(),t=this.totals();assert.ok(!d.halted&&!t.unknown,'ledger_halted_or_unknown_usage');assert.ok(t.requests+1<=limits.requests&&t.input+inputReserve<=limits.input&&t.output+maxTokens<=limits.output,'budget_exhausted_before_request');}
 begin(trialId:string,inputReserve:number){this.assertRequest(inputReserve);const d=this.read(),id=d.requests.length+1;d.requests.push({id,trialId,status:'started',inputReserve});this.write(d);return id;}
 finish(id:number,usage:Usage|undefined,reason?:string){const d=this.read(),r=d.requests.find(r=>r.id===id);assert.equal(r?.status,'started');if(usage){assert.ok(Number.isSafeInteger(usage.input)&&usage.input>=0&&Number.isSafeInteger(usage.output)&&usage.output>=0);r!.usage=usage;}r!.status=reason||!usage?'failed':'finished';if(reason||!usage){r!.reason=reason??'unknown_provider_usage';d.halted??=r!.reason;}this.write(d);const t=this.totals();if(t.input>limits.input||t.output>limits.output)this.halt('actual_usage_exceeded_budget');}
 halt(reason:string){const d=this.read();d.halted??=reason;this.write(d);}
}
