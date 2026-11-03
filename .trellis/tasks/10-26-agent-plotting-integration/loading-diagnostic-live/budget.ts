import assert from 'node:assert/strict';
import {Ledger as BaseLedger,maxTokens,pairReserve,type Usage} from '../evaluation-v2/budget.js';
import {proposedLimits} from '../loading-diagnostic/cases.js';
export const limits=proposedLimits;
/** Reuse persistence/settlement; enforce this diagnostic's lower cap before and after requests. */
export class Ledger extends BaseLedger {
 override canStartPair(){const d=this.read(),t=this.totals();return !d.halted&&!t.unknown&&(['requests','input','output'] as const).every(k=>t[k]+pairReserve[k]<=limits[k]);}
 override assertRequest(inputReserve:number){super.assertRequest(inputReserve);const t=this.totals();assert.ok(t.requests+1<=limits.requests&&t.input+inputReserve<=limits.input&&t.output+maxTokens<=limits.output,'diagnostic_budget_exhausted_before_request');}
 override finish(id:number,usage:Usage|undefined,reason?:string){super.finish(id,usage,reason);const t=this.totals();if(t.requests>limits.requests||t.input>limits.input||t.output>limits.output)this.halt('actual_usage_exceeded_diagnostic_budget');}
}
