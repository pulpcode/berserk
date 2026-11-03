// Offline only: preserve original aggregate, snapshots and scores.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { historicalToolRepairGate } from './scoring.js';
import { verifySnapshotFiles, type ToolCheck } from '../11-03-resource-independent-acceptance/scoring.js';
const source = new URL('../11-03-resource-independent-acceptance/records/aggregate.json', import.meta.url);
const bytes = await readFile(source);
const original = JSON.parse(bytes.toString()) as { toolChecks: ToolCheck[]; aggregate: { main: number; strict: number; passed: boolean; tools: {status: string} } };
for (const check of original.toolChecks) {
  const errors = await verifySnapshotFiles(check.evidence, path => readFile(path));
  if (errors.length) throw new Error(JSON.stringify(errors));
}
const corrected = historicalToolRepairGate(original.toolChecks);
const result = { source: source.pathname, sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  offlineOnly: true, modelRequests: 0, originalToolGate: original.aggregate.tools.status,
  correctedToolGate: corrected.status, rows: corrected.rows.map(({gate,status,requiredCase}) => ({gate,status,requiredCase})),
  unchanged: {main: original.aggregate.main, strict: original.aggregate.strict, acceptancePassed: original.aggregate.passed},
  reason: '冻结规则要求指定P02/N02/N03路径；N02没有资源汇总调用，N05不能替代。已覆盖路径无已审同根回归，不等于指定覆盖齐全。' };
await writeFile(new URL('./erratum.json', import.meta.url), JSON.stringify(result, null, 2)+'\n', {flag: 'wx'});
console.info(JSON.stringify(result));
