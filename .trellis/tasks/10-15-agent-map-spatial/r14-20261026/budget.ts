/** One batch ledger. Every actual request, including child/compaction calls, consumes budget. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
export type Group='A'|'B'|'C';
export const modelConfiguration={
 A:{requestModel:'deepseek-v4.1-flash',responseModel:'deepseek-v4-1-flash-261017',thinking:'disabled',effort:'absent',afpInput:1.25,afpOutput:1.25},
 B:{requestModel:'deepseek-v4.1-flash',responseModel:'deepseek-v4-1-flash-261017',thinking:'enabled',effort:'high',afpInput:1.25,afpOutput:1.25},
 C:{requestModel:'deepseek-v4-pro',responseModel:'deepseek-v4-pro-ga-260813',thinking:'enabled',effort:'high',afpInput:5.5,afpOutput:5.5},
} as const;
export const limits={requests:1600,input:36_000_000,output:3_000_000,afp:12_000} as const;
export const tripleReserve={requests:60,input:1_500_000,output:262_144,afp:1_000} as const;
export const maxTokens=32768;
export interface Usage {input:number;output:number}
export interface AccountPreflight {
 schemaVersion:1;checkedAt:string;sourceEvidence:string;observedOverageEnabled:boolean|null;
 remainingAfp:{fiveHour:number;week:number;month:number};externalUseReserveAfp:number;
 /** Frozen observation is deliberately not replenished when a quota window elapses. */
 sharedUsePolicy:'exclusive_during_batch'|'reserved_other_usage';
}
export function validateAccount(value:AccountPreflight,now=Date.now()){
 assert.equal(value.schemaVersion,1);assert.ok(value.observedOverageEnabled===null||typeof value.observedOverageEnabled==='boolean','invalid_observed_overage_state');
 const time=Date.parse(value.checkedAt);assert.ok(Number.isFinite(time)&&time<=now+60_000,'account_preflight_time_invalid');
 assert.ok(value.sourceEvidence.trim(),'account_evidence_missing');
 for(const k of ['fiveHour','week','month'] as const)assert.ok(Number.isFinite(value.remainingAfp[k])&&value.remainingAfp[k]>=0,'invalid_account_balance');
 assert.ok(value.remainingAfp.fiveHour<=10_000&&value.remainingAfp.week<=35_000&&value.remainingAfp.month<=100_000,'balance_above_medium_allowance');
 assert.ok(Number.isFinite(value.externalUseReserveAfp)&&value.externalUseReserveAfp>=0);
 assert.ok(['exclusive_during_batch','reserved_other_usage'].includes(value.sharedUsePolicy));
 if(value.sharedUsePolicy==='reserved_other_usage')assert.ok(value.externalUseReserveAfp>0,'shared_usage_requires_reserve');
}
export const afp=(usage:Usage,group:Group)=>(usage.input*modelConfiguration[group].afpInput+usage.output*modelConfiguration[group].afpOutput)/10000;
export interface RequestRow {id:number;trialId:string;group:Group;status:'started'|'finished'|'failed';inputReserve:number;outputReserve:number;afpReserve:number;usage?:Usage;afp?:number;reason?:string}
export interface LedgerSeed {requests:RequestRow[];source:{directory:string;freezeHash:string;ledgerHash:string;halted:string|undefined}}
export interface Data {freezeHash:string;account:AccountPreflight;requests:RequestRow[];halted?:string;inherited?:LedgerSeed['source'] & {requests:number}}
export class Ledger {
 constructor(readonly path:string,readonly freezeHash:string,account:AccountPreflight,seed?:LedgerSeed){assert.ok(!existsSync(path),'Refuse reusing ledger');validateAccount(account);if(seed)validateSeed(seed);this.write({freezeHash,account,requests:structuredClone(seed?.requests??[]),...(seed?{inherited:{...seed.source,requests:seed.requests.length}}:{})});}
 private write(data:Data){writeFileSync(this.path+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(this.path+'.tmp',this.path);}
 read():Data{const d=JSON.parse(readFileSync(this.path,'utf8')) as Data;assert.equal(d.freezeHash,this.freezeHash);return d;}
 totals(){const d=this.read();return {requests:d.requests.length,input:d.requests.reduce((n,r)=>n+(r.usage?.input??0),0),output:d.requests.reduce((n,r)=>n+(r.usage?.output??0),0),afp:d.requests.reduce((n,r)=>n+(r.afp??0),0),unknown:d.requests.filter(r=>!r.usage).length};}
 accountRemaining(){const d=this.read(),used=this.totals().afp;return Math.min(...Object.values(d.account.remainingAfp))-d.account.externalUseReserveAfp-used;}
 canStartTriple(){const d=this.read(),t=this.totals();return !d.halted&&!t.unknown&&(['requests','input','output','afp'] as const).every(k=>t[k]+tripleReserve[k]<=limits[k])&&this.accountRemaining()>=tripleReserve.afp;}
 assertRequest(group:Group,inputReserve:number){
  assert.ok(Number.isSafeInteger(inputReserve)&&inputReserve>0);const d=this.read(),t=this.totals();assert.ok(!d.halted&&!t.unknown,'ledger_halted_or_unknown_usage');
  const expectedAfp=afp({input:inputReserve,output:maxTokens},group);
  assert.ok(t.requests+1<=limits.requests&&t.input+inputReserve<=limits.input&&t.output+maxTokens<=limits.output&&t.afp+expectedAfp<=limits.afp,'budget_exhausted_before_request');
  assert.ok(expectedAfp<=this.accountRemaining(),'account_window_reserve_exhausted');
 }
 begin(trialId:string,group:Group,inputReserve:number){this.assertRequest(group,inputReserve);const d=this.read(),id=d.requests.length+1;d.requests.push({id,trialId,group,status:'started',inputReserve,outputReserve:maxTokens,afpReserve:afp({input:inputReserve,output:maxTokens},group)});this.write(d);return id;}
 finish(id:number,usage:Usage|undefined,reason?:string){
  const d=this.read(),r=d.requests.find(r=>r.id===id);assert.equal(r?.status,'started');
  if(usage){assert.ok(Number.isSafeInteger(usage.input)&&usage.input>=0&&Number.isSafeInteger(usage.output)&&usage.output>=0);r!.usage=usage;r!.afp=afp(usage,r!.group);}
  r!.status=reason||!usage?'failed':'finished';if(reason||!usage){r!.reason=reason??'unknown_provider_usage';d.halted??=r!.reason;}this.write(d);
  const t=this.totals();if(t.input>limits.input||t.output>limits.output||t.afp>limits.afp||this.accountRemaining()<0)this.halt('actual_usage_exceeded_budget');
 }
 halt(reason:string){const d=this.read();d.halted??=reason;this.write(d);}
}
export function offlineAccount():AccountPreflight{return {schemaVersion:1,checkedAt:new Date().toISOString(),sourceEvidence:'offline fake transport; no external model calls',observedOverageEnabled:null,remainingAfp:{fiveHour:10_000,week:35_000,month:100_000},externalUseReserveAfp:0,sharedUsePolicy:'exclusive_during_batch'};}

/** Only an explicitly authorized task-local closeout supplies a seed; no original ledger is reopened. */
export function validateSeed(seed:LedgerSeed){
 assert.ok(seed.source.directory&&seed.source.freezeHash&&seed.source.ledgerHash,'inherited_origin_missing');
 for(const [i,r] of seed.requests.entries()){
  assert.equal(r.id,i+1,'inherited_request_ids_not_contiguous');assert.equal(r.status,'finished','inherited_unfinished_request');
  assert.ok(r.usage&&Number.isSafeInteger(r.usage.input)&&r.usage.input>=0&&Number.isSafeInteger(r.usage.output)&&r.usage.output>=0,'inherited_unknown_usage');
  assert.ok(Math.abs((r.afp??NaN)-afp(r.usage,r.group))<1e-9,'inherited_afp_mismatch');
 }
}
export function cumulativeAccount(previous:AccountPreflight,fresh:AccountPreflight,inheritedAfp:number):AccountPreflight{
 validateAccount(previous);validateAccount(fresh);assert.ok(Number.isFinite(inheritedAfp)&&inheritedAfp>=0);
 assert.ok(Date.parse(fresh.checkedAt)>=Date.parse(previous.checkedAt),'account_observation_older_than_original');
 return {...fresh,sourceEvidence:`Cumulative closeout cap: min(original opening balance, fresh balance + inherited AFP ${inheritedAfp}). Fresh observation: ${fresh.sourceEvidence}`,remainingAfp:Object.fromEntries((['fiveHour','week','month'] as const).map(k=>[k,Math.min(previous.remainingAfp[k],fresh.remainingAfp[k]+inheritedAfp)])) as AccountPreflight['remainingAfp'],externalUseReserveAfp:Math.max(previous.externalUseReserveAfp,fresh.externalUseReserveAfp)};
}
