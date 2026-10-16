import {describe,expect,it} from 'vitest';
import {mapTrialBackground} from '../scripts/probe-situation-map.js';
import {remediationCaseIds,remediationSchedule,parseRemediationRuntimes,validateRemediationSources,type RemediationVariant} from '../scripts/probe-spatial-remediation.js';

describe('isolated spatial remediation diagnostics',()=>{
  it('freezes all 180 independent entries with 36 per condition and no best-of selection',()=>{
    const schedule=remediationSchedule();expect(schedule).toHaveLength(180);
    expect(new Set(schedule.map(entry=>entry.id)).size).toBe(180);
    for(const id of ['V0','V1','V2','V3','V4']){
      const entries=schedule.filter(entry=>entry.variant===id);expect(entries).toHaveLength(36);
      expect(new Set(entries.map(entry=>entry.caseId)).size).toBe(12);
      expect(entries.every(entry=>entry.condition===(id==='V3'?'C':'B'))).toBe(true);
      expect(entries.every(entry=>entry.background===(id==='V4'?'neutral':'original'))).toBe(true);
    }
    for(const caseId of remediationCaseIds)for(const repeat of [1,2,3]){
      expect(schedule.filter(entry=>entry.caseId===caseId&&entry.repeat===repeat)).toHaveLength(5);
    }
    expect(schedule[0].variant).not.toBe(schedule[60].variant);
  });
  it('requires one runtime per declared variant',()=>{
    const runtimes=['V0','V1','V2','V3','V4'].map(id=>({id,packageRoot:'/tmp/frozen'}));
    expect(parseRemediationRuntimes({version:1,runtimes}).runtimes).toHaveLength(5);
    expect(()=>parseRemediationRuntimes({version:1,runtimes:runtimes.slice(1)})).toThrow();
    expect(()=>parseRemediationRuntimes({version:1,runtimes:[...runtimes.slice(1),runtimes[1]]})).toThrow();
  });
  it('rejects confounded code/data changes or a sham unchanged treatment',()=>{
    const make=(tool:string,skill:string)=>[
      {file:'fixtures/skills/spatial-analysis/SKILL.md',sha256:skill},
      {file:'scripts/probe-spatial-cases.ts',sha256:'common-fixture'},
      {file:'src/pi/spatial-tools.ts',sha256:tool}];
    const hashes={V0:make('old','old'),V1:make('new','old'),V2:make('new','new'),V3:make('new','new'),V4:make('new','new')};
    expect(validateRemediationSources(hashes)).toEqual({tools:['src/pi/spatial-tools.ts'],skill:['fixtures/skills/spatial-analysis/SKILL.md']});
    for(const id of ['V0','V1','V2','V3','V4'] as RemediationVariant[]){
      const altered=structuredClone(hashes);altered[id][1].sha256='changed-fixture';
      expect(()=>validateRemediationSources(altered)).toThrow();
    }
    expect(()=>validateRemediationSources({...hashes,V0:hashes.V1})).toThrow();
    expect(()=>validateRemediationSources({...hashes,V3:[...hashes.V3,{file:'unexpected.ts',sha256:'x'}]})).toThrow();
  });
  it('preserves default preparation text and neutralizes only synthetic business text',()=>{
    const original={title:'业务任务',goal:'需要3辆车',responsibility:'筹划资源配置'};
    expect(mapTrialBackground({},original)).toBe(original);
    expect(mapTrialBackground({background:'original'},original)).toBe(original);
    const neutral=mapTrialBackground({background:'neutral'},original);
    expect(neutral).toEqual({title:'空间资料核对任务',goal:'空间资料核对合成测试。',responsibility:'合成测试席位。'});
    expect(JSON.stringify(neutral)).not.toMatch(/3辆车|只分析|必须|不得|正确答案/);
    expect(original.goal).toBe('需要3辆车');
  });
});
