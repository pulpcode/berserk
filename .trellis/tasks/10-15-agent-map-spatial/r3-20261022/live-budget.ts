/** Task-local accounting: numerical limits stop NEW slots, never an active slot. */
export const planBudget={requests:900,input:15_000_000,output:200_000};
export const completionReserve={requests:48,input:500_000,output:20_000};
export const warningLines={requests:24,tools:64,elapsedMs:600_000};
export interface Usage {prompt_tokens?:number;completion_tokens?:number;prompt_cache_hit_tokens?:number;prompt_cache_miss_tokens?:number}
export interface Totals {requests:number;input:number;output:number;unknownUsage:number}
export function addUsage(total:Totals,usage?:Usage){
 const input=usage?.prompt_tokens??(Number.isSafeInteger(usage?.prompt_cache_hit_tokens)&&usage!.prompt_cache_hit_tokens!>=0&&Number.isSafeInteger(usage?.prompt_cache_miss_tokens)&&usage!.prompt_cache_miss_tokens!>=0?usage!.prompt_cache_hit_tokens!+usage!.prompt_cache_miss_tokens!:undefined);
 if(!Number.isSafeInteger(input)||input!<0||!Number.isSafeInteger(usage?.completion_tokens)||usage!.completion_tokens!<0){total.unknownUsage++;return false;}
 total.input+=input!;total.output+=usage!.completion_tokens!;return true;
}
export function canStartSlot(total:Totals){return total.unknownUsage===0&&(Object.keys(planBudget) as Array<keyof typeof planBudget>).every(key=>total[key]+completionReserve[key]<=planBudget[key]);}
export function warnings(requests:number,tools:number,elapsedMs:number){return Object.entries({requests,tools,elapsedMs}).filter(([key,value])=>value>=warningLines[key as keyof typeof warningLines]).map(([key])=>key);}
