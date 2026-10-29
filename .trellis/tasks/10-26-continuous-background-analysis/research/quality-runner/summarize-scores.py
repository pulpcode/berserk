from pathlib import Path
import json,sys,collections
root=Path(__file__).resolve().parent
reviews=Path(sys.argv[1]);out=[]
for p in sorted(reviews.glob('*.json')):
 d=json.loads(p.read_text());items=d if isinstance(d,list) else [d]
 for item in items:
  if not isinstance(item,dict) or 'run' not in item or 'rows' not in item:continue
  partial=item.get('partial') is True or item.get('status')=='incomplete'
  run=item['run'];rows=item['rows'];expected=53 if 'spatial' in run else 36
  keys=[(r['round'],r['task']) for r in rows]
  assert len(keys)==len(set(keys)),f'duplicate cells: {p}'
  assert len(rows)==expected or partial,f'incomplete rubric: {p} {len(rows)}/{expected}'
  assert all(type(r.get('coreCorrect')) is bool and type(r.get('evidenceCorrect')) is bool for r in rows),f'non boolean score: {p}'
  assert not any(row['run']==run for row in out),f'duplicate run scoring: {run}'
  out.append({'run':run,'plannedTaskRounds':expected,'scoredTaskRounds':len(rows),'partial':partial,'coreCorrect':sum(r['coreCorrect'] for r in rows),'evidenceCorrect':sum(r['evidenceCorrect'] for r in rows),'source':str(p),'reviewMetadata':{k:v for k,v in item.items() if k!='rows'},'coreFailures':[{'round':r['round'],'task':r['task'],'reason':r.get('reason')} for r in rows if not r['coreCorrect']],'evidenceFailures':[{'round':r['round'],'task':r['task'],'issues':r.get('evidenceIssues')} for r in rows if not r['evidenceCorrect']]})
(root/'semantic-scores.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps([{k:v for k,v in d.items() if k not in ['coreFailures','evidenceFailures']} for d in out],ensure_ascii=False,indent=2))
