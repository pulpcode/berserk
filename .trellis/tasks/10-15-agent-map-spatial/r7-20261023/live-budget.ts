/** Token ceilings are checked before new slots; a progressing slot may finish. */
export {addUsage,warnings} from '../r3-20261022/live-budget.js';
export type {Usage,Totals} from '../r3-20261022/live-budget.js';
import type {Totals} from '../r3-20261022/live-budget.js';
export const planBudget={requests:180,input:2_000_000,output:100_000};
export const completionReserve={requests:24,input:300_000,output:10_000};
export function canStartSlot(total:Totals){return total.unknownUsage===0&&total.requests+completionReserve.requests<=planBudget.requests&&total.input+completionReserve.input<=planBudget.input&&total.output+completionReserve.output<=planBudget.output;}
