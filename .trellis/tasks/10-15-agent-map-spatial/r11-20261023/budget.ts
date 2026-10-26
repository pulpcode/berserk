/** Shared, durable accounting for calibration, Agent requests and initial grading. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
export type Role='agent'|'judge';
export interface Usage {inputTokens:number;outputTokens:number;responseModel:string;providerRequestId?:string;responseSha256?:string}
export interface RequestRecord {id:string;role:Role;trialId:string;startedAt:string;status:'started'|'finished'|'failed';usage?:Usage;reason?:string}
export const formatHalt='Invalid or contradictory judgment; original response preserved';
export interface FormatRecovery {authorization:string;originalLedgerSha256:string;backupPath:string;repairedFreezeHash:string;reusedRequestId:string;canonicalOutputSha256:string;remainingJudgeTrialIds:string[];parentRecoverySha256?:string}
export interface LedgerData {version:1;freezeHash:string;requests:RequestRecord[];halted?:string;recoveries?:Array<FormatRecovery&{at:string;previousHalt:string}>}
export const budgets={total:{requests:720,input:16_000_000,output:400_000},agent:{requests:632,input:13_000_000,output:240_000},judge:{requests:88,input:3_000_000,output:160_000}} as const;
export const trialReserve={requests:36,input:500_000,output:16_000};
export const judgeReserve={requests:1,input:100_000,output:8192};
export const responseModels=['deepseek-v4.1-flash','deepseek-v4-1-flash-261017'];
export function openLedger(path:string,freezeHash:string){return new Ledger(path,freezeHash);}
export class Ledger {
 constructor(readonly path:string,readonly freezeHash:string){this.exclusive(()=>{if(existsSync(path))assert.equal(this.read().freezeHash,freezeHash,'Ledger freeze changed');else this.write({version:1,freezeHash,requests:[]});});}
 private exclusive(action:()=>void){const lock=this.path+'.lock';writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});try{action();}finally{unlinkSync(lock);}}
 read():LedgerData {const data=JSON.parse(readFileSync(this.path,'utf8')) as LedgerData;assert.equal(data.version,1);assert.equal(data.freezeHash,this.freezeHash);assert.equal(new Set(data.requests.map(r=>r.id)).size,data.requests.length);return data;}
 private write(data:LedgerData){const temp=this.path+'.tmp';writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(temp,this.path);}
 totals(role?:Role){const rows=this.read().requests.filter(r=>!role||r.role===role);return {requests:rows.length,input:rows.reduce((n,r)=>n+(r.usage?.inputTokens??0),0),output:rows.reduce((n,r)=>n+(r.usage?.outputTokens??0),0),unknown:rows.filter(r=>r.status!=='finished').length};}
 canStart(role:Role,reserve:{requests:number;input:number;output:number}){const data=this.read();if(data.halted||data.requests.some(r=>r.status!=='finished')||(role==='agent'&&data.recoveries?.length))return false;const own=this.totals(role),all=this.totals();return (['requests','input','output'] as const).every(k=>own[k]+reserve[k]<=budgets[role][k]&&all[k]+reserve[k]<=budgets.total[k]);}
 canStartTrial(){return this.canStart('agent',trialReserve);}
 canStartJudge(){return this.canStart('judge',judgeReserve);}
 beginRequest(request:{id:string;role:Role;trialId:string}){this.exclusive(()=>{const data=this.read();assert.ok(!data.halted&&!data.requests.some(r=>r.status!=='finished'),'Unknown/failed usage prohibits further requests');if(data.recoveries?.length){assert.equal(request.role,'judge','Recovery permits only remaining initial judgments');assert.ok(data.recoveries.at(-1)!.remainingJudgeTrialIds.includes(request.trialId),'Unapproved continuation input');}assert.ok(!data.requests.some(r=>r.id===request.id),'Request IDs are never retried');if(request.role==='judge')assert.ok(!data.requests.some(r=>r.role==='judge'&&r.trialId===request.trialId),'A judge input cannot be graded twice');if(request.role==='judge')assert.ok(this.canStartJudge(),'Judge budget exhausted');data.requests.push({...request,startedAt:new Date().toISOString(),status:'started'});this.write(data);});}
 finishRequest(id:string,usage:Usage){this.exclusive(()=>{const data=this.read(),row=data.requests.find(r=>r.id===id);assert.ok(row?.status==='started','Only in-flight requests can finish');assert.ok(Number.isSafeInteger(usage.inputTokens)&&usage.inputTokens>=0&&Number.isSafeInteger(usage.outputTokens)&&usage.outputTokens>=0);assert.ok(responseModels.includes(usage.responseModel),'Unexpected response model');if(usage.providerRequestId!==undefined)assert.ok(typeof usage.providerRequestId==='string'&&usage.providerRequestId.length>0);if(usage.responseSha256!==undefined)assert.match(usage.responseSha256,/^[a-f0-9]{64}$/);row.status='finished';row.usage=usage;this.write(data);});}
 failRequest(id:string,reason:string){this.exclusive(()=>{const data=this.read(),row=data.requests.find(r=>r.id===id);assert.ok(row,'Missing request');row.status='failed';row.reason=reason;data.halted??=reason;this.write(data);});}
 /** Explicit fixed-snapshot repair stages; original requests and each halt remain in backups/events. */
 recoverFormatHalt(recovery:FormatRecovery){this.exclusive(()=>{
  const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex'),bytes=readFileSync(this.path),data=this.read();
  assert.equal(sha(bytes),recovery.originalLedgerSha256,'Ledger changed since offline approval');assert.equal(sha(readFileSync(recovery.backupPath)),recovery.originalLedgerSha256,'Original ledger backup changed');
  const isSecond=data.requests.length===262,isThird=data.requests.length===270;assert.equal(data.halted,isSecond?'Unsupported additional judgment field reasonDetail':formatHalt,'Only the reviewed format halt can recover');assert.equal(data.recoveries?.length??0,isThird?2:isSecond?1:0,'Only the three reviewed repair stages may recover');assert.ok(recovery.authorization.trim());
  if(isSecond||isThird)assert.equal(recovery.parentRecoverySha256,sha(Buffer.from(JSON.stringify(data.recoveries!.at(-1)))),'Recovery chain changed');else assert.equal(recovery.parentRecoverySha256,undefined);
  for(const hash of [recovery.repairedFreezeHash,recovery.canonicalOutputSha256])assert.match(hash,/^[a-f0-9]{64}$/);
  assert.ok([260,262,270].includes(data.requests.length),'Only the reviewed 260, 262 or 270 request snapshots are authorized');assert.equal(data.requests.filter(r=>r.role==='judge').length,isThird?35:isSecond?27:25);
  assert.ok(data.requests.every(r=>r.status==='finished'&&r.usage&&Number.isSafeInteger(r.usage.inputTokens)&&r.usage.inputTokens>0&&Number.isSafeInteger(r.usage.outputTokens)&&r.usage.outputTokens>0),'Unknown/failed usage cannot recover');
  const reused=data.requests.find(r=>r.id===recovery.reusedRequestId);assert.ok(reused?.role==='judge'&&reused.status==='finished');
  assert.equal(recovery.remainingJudgeTrialIds.length,isThird?53:isSecond?61:63);assert.equal(new Set(recovery.remainingJudgeTrialIds).size,isThird?53:isSecond?61:63);assert.ok(recovery.remainingJudgeTrialIds.every(id=>!data.requests.some(r=>r.role==='judge'&&r.trialId===id)),'Previously graded input cannot repeat');
  data.recoveries=[...(data.recoveries??[]),{...recovery,at:new Date().toISOString(),previousHalt:data.halted}];delete data.halted;this.write(data);
 });}
 halt(reason:string){this.exclusive(()=>{const data=this.read();data.halted??=reason;this.write(data);});}
}

/** Bind the already verified calibration files to real completed requests in this same ledger. */
export function assertCalibrationAccounting(ledger:Ledger,records:Array<{id:string;requestId:string;responseSha256:string;usage:{inputTokens:number;outputTokens:number}}>){assert.equal(records.length,24);assert.equal(new Set(records.map(r=>r.id)).size,24);for(const record of records){const row=ledger.read().requests.find(r=>r.role==='judge'&&r.trialId===record.id);assert.ok(row?.status==='finished','Calibration request absent from shared budget');assert.equal(row.usage?.providerRequestId,record.requestId);assert.equal(row.usage?.responseSha256,record.responseSha256);assert.equal(row.usage?.inputTokens,record.usage.inputTokens);assert.equal(row.usage?.outputTokens,record.usage.outputTokens);}}
