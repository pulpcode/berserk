import { createHash } from 'node:crypto';
import type { AssessmentSource, TaskAssessmentResult } from '../contracts/continuous.js';

const statuses = {met:'满足',blocked:'受阻',unknown:'待核实',not_applicable:'不再适用'};
const text=(v:unknown,max=3000):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max;
export function validateAssessment(value:TaskAssessmentResult, taskId:string, previous:TaskAssessmentResult|undefined, sources:AssessmentSource[], epochId=""):TaskAssessmentResult {
  if(!value||!text(value.summary)||!Array.isArray(value.conditions)||!value.conditions.length||value.conditions.length>40||!Array.isArray(value.recommendations)||value.recommendations.length>20||value.recommendations.some(v=>!text(v)))throw new Error('assessment 必须包含总体判断、1—40个有依据的关键条件和建议数组。');
  const seen=new Set<string>();
  const conditions=value.conditions.map(c=>{
    if(!c||!text(c.id,100)||!text(c.name,200)||!text(c.reason)||!Object.hasOwn(statuses,c.status)||!['source','inference'].includes(c.kind)||!['initial','changed','unchanged','corrected','withdrawn'].includes(c.change)||typeof c.significant!=='boolean'||!Array.isArray(c.evidence)||!c.evidence.length||c.evidence.length>20)throw new Error('条件字段不完整；请填写状态、判断性质、变化和具体证据。');
    const old=previous?.conditions.find(x=>x.id===c.id);
    if(!old&&!c.id.startsWith('new:'))throw new Error(`未知条件 ${c.id}；新条件请使用 new:短名称，已有条件须沿用返回的ID。`);
    const id=old?old.id:createHash('sha256').update(`${epochId}:${taskId}:${c.id}`).digest('hex').slice(0,24);
    if(seen.has(id)||previous?.conditions.some(x=>x.id===id)&&!old)throw new Error('条件标识重复；请沿用已有条件ID。');seen.add(id);
    if(c.before!==(old?.status??null))throw new Error(`条件 ${c.id} 的 before 必须为 ${old?.status??'null'}，不能改写上次状态。`);
    if(!old&&c.change!=='initial'||old&&c.change==='initial'||c.change==='unchanged'&&c.status!==old?.status||c.change==='withdrawn'&&c.status!=='not_applicable')throw new Error('条件变化类型与前后状态不一致。');
    if(c.change==='unchanged'&&c.significant)throw new Error('无实质变化的条件不能标为重要变化。');
    for(const ref of c.evidence){const source=sources.find(x=>x.id===ref.id);if(!source||!text(ref.quote,4000)||!(source.excerpts?source.excerpts.some(part=>part.includes(ref.quote)):source.text.includes(ref.quote)))throw new Error(`证据 ${ref.id} 不存在或引文不匹配原始资料。请使用候选工具返回的 assessmentSources。`);if(source.kind==='calculation'&&(c.kind!=='inference'||ref.quote!==source.text&&ref.quote!==JSON.stringify((JSON.parse(source.text) as {result:unknown}).result)))throw new Error('计算是派生依据，请标为inference并引用完整计算结果或result的JSON值，不得只摘操作名。');}
    if(old&&old.kind==='inference'&&c.kind==='source'&&c.evidence.every(ref=>old.evidence.some(e=>e.id===ref.id&&e.quote===ref.quote)))throw new Error('旧推断转为来源事实需要新的来源依据，不能仅沿用原推断引用。');
    return {...c,id};
  });
  if(previous?.conditions.some(c=>!seen.has(c.id)))throw new Error('已有条件不能静默遗漏；请保留、纠正或明确撤回。');
  return {...value,conditions};
}
