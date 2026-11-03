import assert from 'node:assert/strict';
import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
export const limits = {requests:120,input:4_000_000,output:500_000} as const;
export const profile = {provider:'volcengine-agent-plan',model:'deepseek-v4.1-flash',baseUrl:'https://ark.cn-beijing.volces.com/api/plan/v3',thinkingMode:'high',contextWindow:1_024_000,maxOutputTokens:32_768} as const;
export interface Usage {input:number;output:number}
export interface Attempt {id:number;trialId:string;startedAt:string;status:'pending'|'finished'|'failed';reserve:Usage;usage?:Usage;reason?:string}
export interface LedgerData {freezeHash:string;attempts:Attempt[];responseModel?:string;halted?:string}
export class Ledger {
 constructor(readonly path:string,readonly freezeHash:string, resume=false) {
  if(resume){assert.equal(this.read().freezeHash,freezeHash);assert.ok(!this.read().attempts.some(a=>a.status==='pending'),'unsettled_request');}
  else {assert.ok(!existsSync(path),'Refuse replacing existing ledger');this.write({freezeHash,attempts:[]});}
 }
 private write(data:LedgerData){writeFileSync(this.path+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(this.path+'.tmp',this.path);}
 read():LedgerData{return JSON.parse(readFileSync(this.path,'utf8')) as LedgerData;}
 totals(trialId?:string){const saved=this.read(),data={...saved,attempts:saved.attempts.filter(a=>!trialId||a.trialId===trialId)};return {requests:data.attempts.length,input:data.attempts.reduce((n,a)=>n+(a.usage?.input??0),0),output:data.attempts.reduce((n,a)=>n+(a.usage?.output??0),0),reservedInput:data.attempts.filter(a=>!a.usage).reduce((n,a)=>n+a.reserve.input,0),reservedOutput:data.attempts.filter(a=>!a.usage).reduce((n,a)=>n+a.reserve.output,0),unknown:data.attempts.filter(a=>!a.usage).length,halted:data.halted};}
 begin(trialId:string,inputReserve:number,outputReserve:number){
  assert.ok(Number.isSafeInteger(inputReserve)&&inputReserve>0&&Number.isSafeInteger(outputReserve)&&outputReserve>0&&outputReserve<=profile.maxOutputTokens,'invalid_reservation');
  const data=this.read(),t=this.totals();assert.ok(!data.halted,'ledger_halted: '+data.halted);
  assert.ok(t.requests<limits.requests&&t.input+t.reservedInput+inputReserve<=limits.input&&t.output+t.reservedOutput+outputReserve<=limits.output,'budget_exhausted');
  const id=data.attempts.length+1;data.attempts.push({id,trialId,startedAt:new Date().toISOString(),status:'pending',reserve:{input:inputReserve,output:outputReserve}});this.write(data);return id;
 }
 finish(id:number,usage:Usage|undefined,reason?:string){
  const data=this.read(),row=data.attempts.find(a=>a.id===id);assert.equal(row?.status,'pending');
  if(usage){assert.ok(Object.values(usage).every(n=>Number.isSafeInteger(n)&&n>=0));row!.usage=usage;if(usage.input>row!.reserve.input||usage.output>row!.reserve.output)data.halted??='usage_reservation_overflow';}
  row!.status=reason||!usage?'failed':'finished';if(reason)row!.reason=reason;
  // An unmetered response is never treated as zero or silently retried by the harness.
  if(!usage)data.halted??='unknown_provider_usage';
  this.write(data);
 }
 observeModel(model:string){const data=this.read();if(data.responseModel&&data.responseModel!==model){this.halt('response_model_drift');return false;}data.responseModel??=model;this.write(data);return true;}
 halt(reason:string){const data=this.read();data.halted??=reason;this.write(data);}
}

export const models={A:{...profile,responseModel:'deepseek-v4-1-flash-261017'},B:{...profile,provider:'aliyun-bailian',model:'qwen3.8-max-0902',baseUrl:'https://ws-9o7uja66sj6pvrf9.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',responseModel:'qwen3.8-max-0902'}} as const;
