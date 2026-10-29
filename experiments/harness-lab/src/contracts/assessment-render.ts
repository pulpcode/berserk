import type { AnalysisUpdate } from './continuous.js';
function citation(id:string,quote:string,update:AnalysisUpdate){const source=update.assessmentSources?.find(s=>s.id===id);if(source?.kind==='calculation'){try{const v=JSON.parse(source.text) as {operation:string;values:unknown[];result:unknown;unit:string};return `[${id}] 工具核算：${v.operation}(${v.values.join('，')}) = ${String(v.result)} ${v.unit}`;}catch{return `[${id}] 计算记录不可解析`;}}return `[${id}] ${quote}`;}
const changes = {initial:'首次记录',changed:'条件变化',unchanged:'保持不变',corrected:'纠正旧判断',withdrawn:'撤回旧判断'};
const statuses = {met:'满足',blocked:'受阻',unknown:'待核实',not_applicable:'不再适用'};
export function renderAssessment(update:AnalysisUpdate,taskId?:string):string|undefined {
  const tasks=update.taskUpdates.filter(t=>!taskId||t.taskId===taskId);
  if(!tasks.length)return update.assessmentSources&&!taskId?update.unassigned.reason:undefined;
  if(tasks.some(t=>!t.assessment))return;
  return tasks.map(t=>{
    const a=t.assessment!;
    return [`## ${t.taskTitle}`,a.summary,...a.conditions.map(c=>`- **${c.name}**：${c.before?statuses[c.before as keyof typeof statuses]??c.before:'首次'} → ${statuses[c.status]}；${changes[c.change]}；${c.kind==='source'?'来源陈述':'模型推断'}${c.significant?'；重要变化':''}。${c.reason}\n  依据：${c.evidence.map(e=>citation(e.id,e.quote,update)).join('；')}`),...(a.recommendations.length?['建议：',...a.recommendations.map(s=>`- ${s}`)]:[])].join('\n\n');
  }).join('\n\n')+(!taskId?`\n\n未归属任务：${update.unassigned.reason}`:'');
}
