import json,sys
from pathlib import Path
batch=Path('/Users/lau/.codex/worktrees/agent-spatial-plotting/berserk/.local/resource-independent-acceptance/20261103-live-01')
entry=sys.argv[1];p=batch/entry
ledger=json.loads((batch/'ledger.json').read_text());rows=[r for r in ledger['attempts'] if r['trialId']==entry]
print(json.dumps({'entry':entry,'attempts':len(rows),'cumulative':len(ledger['attempts']),'halted':ledger.get('halted'),'pending':sum(r['status']=='pending' for r in rows),'unknownSettled':sum(r['status']!='pending' and not r.get('usage') for r in rows)},ensure_ascii=False))
if (p/'result.json').exists():print('RESULT', (p/'result.json').read_text())
for path in sorted(p.glob('*-review.json')):
 if path.name=='continuation-review.json':continue
 d=path.with_name(path.name.replace('-review.json','-decision.json'))
 if d.exists():continue
 x=json.loads(path.read_text());e=x['evidence'];s=e.get('snapshot',e.get('progress',{}));print('REVIEW',path.name,'HASH',x['evidenceHash']);print('OBSERVED',json.dumps(e.get('observed'),ensure_ascii=False));print('INTERACTION',json.dumps(e.get('interaction'),ensure_ascii=False));print('FACTS',json.dumps(e.get('humanFacts'),ensure_ascii=False));print('LASTRESULT',json.dumps(s.get('lastResult'),ensure_ascii=False))
 for m in s.get('messages',[]):
  if m.get('role') in ['user','assistant']:print(m.get('role'),m.get('id'),m.get('text'))
  elif m.get('role')=='tool':print('TOOL',m.get('toolName'),'error',m.get('isError'),m.get('text')[:600] if m.get('isError') else '')
