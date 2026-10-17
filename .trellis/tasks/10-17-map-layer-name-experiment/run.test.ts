import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {newLayers,prompts,schedule,kinds} from './fixtures.js';
import {prompts as original} from '../10-17-map-query-native-evaluation/fixtures.js';
import {checkFreeze} from './run.js';

test('two fixed repeats include original prompts unchanged and held-out name cases',()=>{
  assert.equal(schedule.length,14);
  for(const kind of kinds)assert.equal(schedule.filter(x=>x.kind===kind).length,2);
  for(const kind of ['F1','F2','F3','prep'] as const)assert.equal(prompts[kind],original[kind]);
  const n1=newLayers('N1');assert.deepEqual(n1[1].features.slice(1,3).map(x=>x.name),['柳湾岸','芦苇岸']);
  assert.equal(newLayers('N2').filter(x=>x.name==='临时停靠').length,2);
  assert.ok(!newLayers('N3').some(x=>x.name==='备用观察'));
  assert.equal(newLayers('N4')[0].features[1].name,'灯塔观察点');
  for(const kind of ['N1','N2','N3','N4'] as const)for(const layer of newLayers(kind)) {
    assert.ok(!prompts[kind].includes(layer.layerId));
    for(const feature of layer.features)assert.ok(!prompts[kind].includes(feature.name));
  }
});
test('source freeze rejects changes rather than silently testing a different product',()=>{
  const root=mkdtempSync(join(tmpdir(),'layer-name-freeze-'));writeFileSync(join(root,'one'),'first');
  const hashes={one:createHash('sha256').update('first').digest('hex')};checkFreeze(root,hashes);
  writeFileSync(join(root,'one'),'changed');assert.throws(()=>checkFreeze(root,hashes),/Frozen file changed/);
});
