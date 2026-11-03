// Offline report assembly only. Never starts a task or makes a provider request.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateAcceptance, verifySnapshotFiles } from '../scoring.ts';

const here = dirname(fileURLToPath(import.meta.url));
const batch = resolve(process.argv[2] ?? '.local/resource-independent-acceptance/20261103-live-01');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const scores = [];
const trajectories = [];
for (const file of (await readdir(join(here, 'adjudicated'))).filter(x => x.endsWith('.json')).sort()) {
  const entry = await readJson(join(here, 'adjudicated', file));
  const errors = await verifySnapshotFiles(entry.packet.snapshots, path => readFile(path));
  if (errors.length) throw Error(JSON.stringify({ file, errors }));
  scores.push(entry.score);
  const tools = entry.packet.snapshots.filter(s => s.kind === 'tool');
  const skills = tools.filter(s => ['skill_read', 'skill.read'].includes(s.toolName)).map(s => {
    try { return JSON.parse(s.text).id ?? 'unknown'; } catch { return 'unparsed'; }
  });
  trajectories.push({entryId:entry.score.entryId, skills:[...new Set(skills)], toolResults:tools.length,
    toolErrors:tools.filter(s=>s.isError).map(s=>({id:s.id,toolName:s.toolName,text:s.text})),
    tools:[...new Set(tools.map(s=>s.toolName))]});
}
const toolChecks = [];
for (const reviewer of ['reviewer-one', 'reviewer-two']) {
  for (const file of (await readdir(join(here, reviewer))).filter(x => x.endsWith('.md')).sort()) {
    const markdown = await readFile(join(here, reviewer, file), 'utf8');
    for (const match of markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
      const value = JSON.parse(match[1]);
      for (const check of Array.isArray(value) ? value : [value]) {
        if (!check.id || !check.gate || !check.coverage || !Array.isArray(check.evidence)) continue;
        const errors = await verifySnapshotFiles(check.evidence, path => readFile(path));
        if (errors.length) throw Error(JSON.stringify({ file, gate: check.gate, errors }));
        toolChecks.push(check);
      }
    }
  }
}
const originalToolChecks = structuredClone(toolChecks);
const coverageAdjudications = await readJson(join(here,'tool-coverage-adjudications.json'));
for (const decision of coverageAdjudications) {
  for (const check of toolChecks.filter(c=>c.entryId===decision.entryId && c.gate===decision.gate)) {
    check.coverage=decision.coverage;check.verdict=decision.verdict;
    check.reviewer += '；Codex主会话复核';check.rationale += ` 主会话裁决：${decision.rationale}`;
  }
}
const aggregate = aggregateAcceptance(scores, toolChecks);
const ledger = await readJson(join(batch, 'ledger.json'));
const trialIds = [...new Set(ledger.attempts.map(x => x.trialId))];
const usage = trialIds.map(entryId => {
  const attempts = ledger.attempts.filter(x => x.trialId === entryId);
  return { entryId, attempts: attempts.length, input: attempts.reduce((s,x) => s+(x.usage?.input ?? 0),0),
    output: attempts.reduce((s,x) => s+(x.usage?.output ?? 0),0), unsettled: attempts.filter(x => !x.usage).length };
});
const compact = scores.map(({entryId,caseId,repeat,cohort,status,mainTask,explanation,strict,critical,expressionIssues,issues}) =>
  ({entryId,caseId,repeat,cohort,status,mainTask,explanation,strict,critical,expressionIssues,issues}));
await writeFile(join(here,'aggregate.json'),JSON.stringify({aggregate,usage,toolChecks,originalToolChecks,coverageAdjudications,trajectories},null,2)+'\n');
await writeFile(join(here,'scores-summary.json'),JSON.stringify(compact,null,2)+'\n');
console.log(JSON.stringify({scores:compact, usage, formal:{reviewed:aggregate.reviewed,main:aggregate.main,strict:aggregate.strict,
  formalPassed:aggregate.formalPassed,passed:aggregate.passed,bothSuccessful:aggregate.bothSuccessful,doubleFailures:aggregate.doubleFailures},
  tools:aggregate.tools.rows.map(({gate,status})=>({gate,status}))},null,2));
