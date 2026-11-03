from pathlib import Path
import json,collections
root=Path(__file__).resolve().parent
out=[]
for run in sorted((root/'evidence').iterdir()):
 if not (run/'review.json').exists():continue
 totals=collections.Counter()
 for f in run.glob('background/streams/*/*/sessions/*.jsonl'):
  for line in f.open():
   m=json.loads(line).get('message',{})
   if m.get('role')!='assistant':continue
   calls=[x for x in m.get('content',[]) if isinstance(x,dict) and x.get('type')=='toolCall']
   usage=m.get('usage',{});category='toolTurns' if calls else 'finalTurns'
   totals[category]+=1;totals[category+'OutputTokens']+=usage.get('output',0)
   if any(c.get('name')=='information_record_analysis_update' for c in calls):totals['recordTurnsOutputTokens']+=usage.get('output',0)
 out.append({'run':run.name,**totals})
(root/'output-breakdown.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
