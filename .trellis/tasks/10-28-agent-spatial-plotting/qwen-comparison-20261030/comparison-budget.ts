import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
export type Group='A'|'B';
const flash={requestModel:'deepseek-v4.1-flash',responseModel:'deepseek-v4-1-flash-261017',thinking:'enabled',effort:'high'} as const;
export const modelConfiguration={A:flash,B:{requestModel:'qwen3.8-max-0902',responseModel:'qwen3.8-max-0902',thinking:'enabled',effort:'xhigh'}} as const;
export const limits={requests:64,input:2_000_000,output:200_000} as const;
export const maxTokens=32768;
export interface Usage {input:number;output:number}
interface Row {id:number;trialId:string;group:Group;status:'started'|'finished'|'failed';usage?:Usage;reason?:string}
interface Data {smoke:{requests:number;input:number;output:number};freezeHash:string;requests:Row[];halted?:string}
export class Ledger {
 constructor(readonly path:string,readonly freezeHash:string){assert.ok(!existsSync(path),'Refuse reusing ledger');this.write({freezeHash,requests:[],smoke:{requests:4,input:1516,output:181}});}
 private write(d:Data){writeFileSync(this.path+'.tmp',JSON.stringify(d,null,2)+'\n',{mode:0o600});renameSync(this.path+'.tmp',this.path);}
 read(){const d=JSON.parse(readFileSync(this.path,'utf8')) as Data;assert.equal(d.freezeHash,this.freezeHash);return d;}
 totals(){const d=this.read();return {requests:d.smoke.requests+d.requests.length,input:d.smoke.input+d.requests.reduce((n,r)=>n+(r.usage?.input??0),0),output:d.smoke.output+d.requests.reduce((n,r)=>n+(r.usage?.output??0),0),unknown:d.requests.filter(r=>!r.usage).length};}
 begin(trialId:string,group:Group,inputReserve:number){const d=this.read(),t=this.totals();assert.ok(!d.halted&&!t.unknown,'ledger_halted_or_unknown_usage');assert.ok(t.requests<limits.requests&&t.input+inputReserve<=limits.input&&t.output+maxTokens<=limits.output,'budget_exhausted');const id=d.requests.length+1;d.requests.push({id,trialId,group,status:'started'});this.write(d);return id;}
 finish(id:number,usage:Usage|undefined,reason?:string){const d=this.read(),r=d.requests.find(r=>r.id===id);assert.equal(r?.status,'started');if(usage){assert.ok(Number.isSafeInteger(usage.input)&&usage.input>=0&&Number.isSafeInteger(usage.output)&&usage.output>=0);r!.usage=usage;}r!.status=reason||!usage?'failed':'finished';if(reason||!usage){r!.reason=reason??'unknown_provider_usage';d.halted??=r!.reason;}this.write(d);const t=this.totals();if(t.input>=limits.input||t.output>=limits.output||t.requests>=limits.requests)this.halt('budget_exhausted');}
 halt(reason:string){const d=this.read();d.halted??=reason;this.write(d);}
}
