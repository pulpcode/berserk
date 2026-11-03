/** One batch usage ledger, including every child/compaction request. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
export type Group='G0'|'GS'|'GT'|'GST';
const flash={requestModel:'deepseek-v4.1-flash',responseModel:'deepseek-v4-1-flash-261017',thinking:'enabled',effort:'high',afpInput:1.25,afpOutput:1.25} as const;
export const modelConfiguration={G0:flash,GS:flash,GT:flash,GST:flash} as const;
export const limits={requests:3000,input:60_000_000,output:4_000_000,afp:8_000} as const;
/** Original plan reference only; explicit user authorization removed artificial ceilings. */
export const quartetReserve={requests:100,input:1_200_000,output:262_144,afp:200} as const;
export const budgetPolicy={mode:'unlimited_explicit_user_approval',authorization:'2026-10-28 用户：不设额度，开始测试',originalPlanLimits:limits,originalPlanReserve:quartetReserve,fixedTaskSlots:288,automaticRetries:false,additionalTrials:false} as const;
export const maxTokens=32768;
export interface Usage {input:number;output:number}
export interface AccountPreflight {
 schemaVersion:1;checkedAt:string;sourceEvidence:string;observedOverageEnabled:boolean|null;
 remainingAfp:{fiveHour:number;week:number;month:number};externalUseReserveAfp:number;
 /** Frozen observation is deliberately not replenished when a quota window elapses. */
 sharedUsePolicy:'exclusive_during_batch'|'reserved_other_usage'|'observed_shared_usage';
}
export function validateAccount(value:AccountPreflight,now=Date.now()){
 assert.equal(value.schemaVersion,1);assert.ok(value.observedOverageEnabled===null||typeof value.observedOverageEnabled==='boolean','invalid_observed_overage_state');
 const time=Date.parse(value.checkedAt);assert.ok(Number.isFinite(time)&&time<=now+60_000,'account_preflight_time_invalid');
 assert.ok(value.sourceEvidence.trim(),'account_evidence_missing');
 for(const k of ['fiveHour','week','month'] as const)assert.ok(Number.isFinite(value.remainingAfp[k])&&value.remainingAfp[k]>=0,'invalid_account_balance');
 assert.ok(value.remainingAfp.fiveHour<=10_000&&value.remainingAfp.week<=35_000&&value.remainingAfp.month<=100_000,'balance_above_medium_allowance');
 assert.ok(Number.isFinite(value.externalUseReserveAfp)&&value.externalUseReserveAfp>=0);
 assert.ok(['exclusive_during_batch','reserved_other_usage','observed_shared_usage'].includes(value.sharedUsePolicy));
 if(value.sharedUsePolicy==='reserved_other_usage')assert.ok(value.externalUseReserveAfp>0,'shared_usage_requires_reserve');
}
export const afp=(usage:Usage,group:Group)=>(usage.input*modelConfiguration[group].afpInput+usage.output*modelConfiguration[group].afpOutput)/10000;
export interface RequestRow {id:number;trialId:string;group:Group;status:'started'|'finished'|'failed';inputReserve:number;outputReserve:number;afpReserve:number;usage?:Usage;afp?:number;reason?:string}
export interface Data {freezeHash:string;account:AccountPreflight;requests:RequestRow[];halted?:string}
export class Ledger {
 constructor(readonly path:string,readonly freezeHash:string,account:AccountPreflight){assert.ok(!existsSync(path),'Refuse reusing ledger');validateAccount(account);this.write({freezeHash,account,requests:[]});}
 private write(data:Data){writeFileSync(this.path+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(this.path+'.tmp',this.path);}
 read():Data{const d=JSON.parse(readFileSync(this.path,'utf8')) as Data;assert.equal(d.freezeHash,this.freezeHash);return d;}
 totals(){const d=this.read();return {requests:d.requests.length,input:d.requests.reduce((n,r)=>n+(r.usage?.input??0),0),output:d.requests.reduce((n,r)=>n+(r.usage?.output??0),0),afp:d.requests.reduce((n,r)=>n+(r.afp??0),0),unknown:d.requests.filter(r=>!r.usage).length};}
 accountRemaining(){const d=this.read(),used=this.totals().afp;return Math.min(...Object.values(d.account.remainingAfp))-d.account.externalUseReserveAfp-used;}
 canStartQuartet(){const d=this.read(),t=this.totals();return !d.halted&&!t.unknown;}
 assertRequest(group:Group,inputReserve:number){
  assert.ok(Number.isSafeInteger(inputReserve)&&inputReserve>0);const d=this.read(),t=this.totals();assert.ok(!d.halted&&!t.unknown,'ledger_halted_or_unknown_usage');
  void group; // User removed artificial amount/request/token ceilings; real failures still halt.
 }
 begin(trialId:string,group:Group,inputReserve:number){this.assertRequest(group,inputReserve);const d=this.read(),id=d.requests.length+1;d.requests.push({id,trialId,group,status:'started',inputReserve,outputReserve:maxTokens,afpReserve:afp({input:inputReserve,output:maxTokens},group)});this.write(d);return id;}
 finish(id:number,usage:Usage|undefined,reason?:string){
  const d=this.read(),r=d.requests.find(r=>r.id===id);assert.equal(r?.status,'started');
  if(usage){assert.ok(Number.isSafeInteger(usage.input)&&usage.input>=0&&Number.isSafeInteger(usage.output)&&usage.output>=0);r!.usage=usage;r!.afp=afp(usage,r!.group);}
  r!.status=reason||!usage?'failed':'finished';if(reason||!usage){r!.reason=reason??'unknown_provider_usage';d.halted??=r!.reason;}this.write(d);
  // Usage remains recorded even beyond the original planning reference.
 }
 halt(reason:string){const d=this.read();d.halted??=reason;this.write(d);}
}
export function offlineAccount():AccountPreflight{return {schemaVersion:1,checkedAt:new Date().toISOString(),sourceEvidence:'offline fake transport; no external model calls',observedOverageEnabled:null,remainingAfp:{fiveHour:10_000,week:35_000,month:100_000},externalUseReserveAfp:0,sharedUsePolicy:'exclusive_during_batch'};}

