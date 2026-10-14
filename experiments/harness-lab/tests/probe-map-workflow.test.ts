import {describe,expect,it} from 'vitest';
import {layerCases,layerScenario,mainScenario,workflowCases,workflowOptions} from '../scripts/probe-map-workflow.js';
describe('fixed map workflow experiment',()=>{
  it('fixes three independent main runs and four paired Skill availability cases',()=>{
    const cases=workflowCases(); expect(cases).toHaveLength(11);
    expect(cases.filter(c=>c.kind==='main').map(c=>c.run)).toEqual([1,2,3]);
    for(const kind of layerCases)expect(cases.filter(c=>c.kind===kind).map(c=>c.skill)).toEqual([true,false]);
    expect(workflowOptions([])).toEqual({port:4343,prepareOnly:false,recovery:false});
    for(const args of [['--runs','4'],['--retry'],['--port','0'],['--approve-all']])expect(()=>workflowOptions(args)).toThrow();
  });
  it('retests the original empty-draft flow without prepared layers or corrective tool hints',()=>{
    const options=workflowOptions(['--recovery','--prepare-only']);
    const cases=workflowCases(options.recovery);
    expect(cases).toHaveLength(3);expect(cases.map(c=>c.run)).toEqual([1,2,3]);
    expect(cases.every(c=>c.kind==='main'&&c.skill)).toBe(true);
    expect(mainScenario(3,true)).toEqual(mainScenario(3));
    expect(mainScenario(1).emptyDraft).toBe(false);expect(mainScenario(2).emptyDraft).toBe(false);
    for(const spec of cases) {
      const scenario=mainScenario(spec.run,true);
      expect(scenario.emptyDraft).toBe(true);expect(scenario.prompt).toContain('当前还没有草稿');
      expect(scenario.prompt).not.toMatch(/annotation_|situation_query|expectedRevision|target-/);
    }
  });
  it('keeps layer ambiguity real and does not disclose target IDs in business prompts',()=>{
    expect(layerScenario('duplicate').layers.map(l=>l.name)).toEqual(['观察记录','观察记录']);
    expect(layerScenario('unspecified').expectClarification).toBe(true);
    expect(layerScenario('existing').prompt).toContain('已有');expect(layerScenario('new').prompt).toContain('另建');
    for(const kind of layerCases)for(const layer of layerScenario(kind).layers)expect(layerScenario(kind).prompt).not.toContain(layer.layerId);
  });
});
