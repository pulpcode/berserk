import {isDeepStrictEqual} from 'node:util';
import type {Ledger} from './budget.js';

/** Capture one settled slot from the authoritative ledger and cross-check transport evidence.
 * Known token sums and unknown usage are separate; a zero-request slot is not unknown usage.
 */
export function slotAccounting(ledger:Ledger,attempts:ReadonlyArray<Record<string,unknown>>,slot:string,tools:number){
 const requests=ledger.read().requests.filter(row=>row.trialId===slot),sent=attempts.filter(row=>row.slot===slot),issues:string[]=[];
 const ids=requests.map(row=>row.id),attemptIds=sent.map(row=>row.id);
 if(!isDeepStrictEqual(ids,attemptIds))issues.push('ledger_attempt_identity_mismatch');
 for(const row of requests){
  const attempt=sent.find(item=>item.id===row.id),output=attempt?.output as {usage?:unknown}|undefined;
  if(row.status==='started'||attempt?.completed!==true)issues.push(`unsettled_request:${row.id}`);
  if(!isDeepStrictEqual(row.usage,output?.usage))issues.push(`ledger_attempt_usage_mismatch:${row.id}`);
 }
 return {requests:requests.length,tools,usage:{input:requests.reduce((sum,row)=>sum+(row.usage?.input??0),0),output:requests.reduce((sum,row)=>sum+(row.usage?.output??0),0),unknown:requests.filter(row=>!row.usage).length},providerRequestIds:ids,accountingIssues:issues};
}
