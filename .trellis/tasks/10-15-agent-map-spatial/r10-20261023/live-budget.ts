export {warnings} from '../r7-20261023/live-budget.js';
export type {Totals} from '../r7-20261023/live-budget.js';
import type {Totals} from '../r7-20261023/live-budget.js';
export const planBudget={requests:480,input:8_000_000,output:250_000};
export const completionReserve={requests:24,input:300_000,output:10_000};
export function canStartSlot(t:Totals){return t.unknownUsage===0&&t.requests+24<=480&&t.input+300_000<=8_000_000&&t.output+10_000<=250_000;}
