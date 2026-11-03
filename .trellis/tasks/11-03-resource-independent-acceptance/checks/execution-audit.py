import json,sys,hashlib
from pathlib import Path
batch=Path('/Users/lau/.codex/worktrees/agent-spatial-plotting/berserk/.local/resource-independent-acceptance/20261103-live-01');entry=sys.argv[1];p=batch/entry
read=lambda f:json.loads(f.read_text())
result=read(p/'result.json');ledger=read(batch/'ledger.json');rows=[r for r in ledger['attempts'] if r['trialId']==entry]
assert not ledger.get('halted'),ledger.get('halted');assert rows and all(r['status']!='pending' and r.get('usage') is not None for r in rows)
assert result['status'] in ['trajectory_recorded','incomplete'],result['status']
for n in ['manifest.json','fixture.json','state-before.json','state-after.json','final-snapshot.json']:assert (p/n).exists(),n
assert list((p/'native-history').glob('*.jsonl'))
for r in rows:
 stem=p/f'provider-{r["id"]:04d}';audit=read(Path(str(stem)+'-request-audit.json'));meta=read(Path(str(stem)+'-response-meta.json'));digest=hashlib.sha256(Path(str(stem)+'-request.json').read_bytes()).hexdigest();assert audit['bodyUnchanged'] and digest==audit['sha256']==audit['forwardedSha256'];assert meta['usage']==r['usage'];assert meta['done'] and meta['models']
before=read(p/'state-before.json');after=read(p/'state-after.json');changed=before!=after;assert changed==result['stateChanged'];diff=[k for k in before if before[k]!=after.get(k)]
manifest=read(p/'manifest.json');assert read(p/'fixture.json')['taskId']==manifest['taskId'];other=[read(f) for f in batch.glob('*/manifest.json') if f.parent!=p];assert all(m['taskId']!=manifest['taskId'] and m['sessionId']!=manifest['sessionId'] and m['dataDir']!=manifest['dataDir'] for m in other)
audit={'entry':entry,'status':result['status'],'attempts':len(rows),'cumulative':len(ledger['attempts']),'input':sum(r['usage']['input'] for r in rows),'output':sum(r['usage']['output'] for r in rows),'stateChanged':changed,'stateDiffKeys':diff,'historyFiles':len(list((p/'native-history').glob('*.jsonl'))),'finalStatus':read(p/'final-snapshot.json').get('lastResult',{}).get('status'),'bodyHashesVerified':True,'knownUsageVerified':True,'identityIsolationVerified':True}
print(json.dumps(audit,ensure_ascii=False))
if len(sys.argv)>2:
 assert not changed,'Changed state needs explicit additional effect review before continuing'
 for path,data in [(p/'execution-audit.json',audit),(p/'continuation-review.json',{'reviewer':'Codex执行席','rationale':sys.argv[2],'continuationAllowed':True,'trajectoryAuditable':True,'isolatedEffectsVerified':True})]:
  with path.open('x') as f:json.dump(data,f,ensure_ascii=False,indent=2);f.write('\n')
