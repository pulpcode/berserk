/** Conservative smoke allowance; active progressing tasks are never cut at a numerical line. */
export {addUsage,warnings} from '../r3-20261022/live-budget.js';
import type {Totals} from '../r3-20261022/live-budget.js';
export type {Totals};
export const planBudget={requests:180,input:3_000_000,output:60_000};
export const completionReserve={requests:24,input:300_000,output:10_000};
export function canStartSlot(total:Totals){return total.unknownUsage===0&&(Object.keys(planBudget) as Array<keyof typeof planBudget>).every(key=>total[key]+completionReserve[key]<=planBudget[key]);}
