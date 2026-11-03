import assert from 'node:assert/strict';
import {aggregateV2,type ScoreV2} from '../11-02-resource-rules-evidence/evaluation-v2.js';
import {criticalKeys} from '../11-02-task-resource-acceptance/scoring.js';
import {schedule,type Group} from './cases.js';
export type GroupScore=ScoreV2 & {group:Group};
export function comparisonSummary(scores:GroupScore[]){
 assert.equal(new Set(scores.map(s=>`${s.group}/${s.caseId}/${s.repeat}`)).size,scores.length,'duplicate_slot');
 assert.ok(scores.every(s=>schedule.some(p=>p.group===s.group&&p.caseId===s.caseId&&p.repeat===s.repeat&&p.phase===s.cohort)),'unplanned_slot');
 return (['A','B'] as const).map(group=>{
  const slots=schedule.filter(s=>s.group===group&&s.phase==='formal'),rows=scores.filter(s=>s.group===group&&s.cohort==='formal');
  const aggregate=aggregateV2(rows,slots),publicRows=scores.filter(s=>s.group===group&&s.cohort==='public');
  const doubleFailures=[...new Set(slots.map(s=>s.caseId))].filter(id=>[1,2].every(repeat=>rows.some(s=>s.caseId===id&&s.repeat===repeat&&s.status==='reviewed'&&s.mainTask===false)));
  return {group,...aggregate,mainRate:aggregate.main/12,strictRate:aggregate.strict/12,publicRows,doubleFailures,
   modelScoreThresholdMet:aggregate.reviewed===12&&aggregate.main>=11&&aggregate.strict>=11&&criticalKeys.every(k=>aggregate.criticalPasses[k]===12)&&doubleFailures.length===0};
 });
}
