import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {toolRegressions} from './tool-regression.js';
test('T01/T02/T03 use actual HTTP, native tools, fixed result read and spatial reuse',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scope-tool-regression-'));
 console.info('Retained deterministic evidence: '+directory);
 const results=await toolRegressions(directory);assert.deepEqual(results.map(r=>r.id),['T01','T02','T03']);
});
