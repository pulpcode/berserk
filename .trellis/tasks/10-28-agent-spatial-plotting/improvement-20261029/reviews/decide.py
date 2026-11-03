# Writes only the explicitly supplied reviewer decision; never classifies or calls a model.
import sys,json
from pathlib import Path
base=Path('.local/agent-spatial-plotting-improvement-20261029/live');out=Path('.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/reviews')
p=json.loads((base/'pending.json').read_text());expected,action,reason=sys.argv[1:4];assert p['id']==expected
result={'checkpointHash':p['checkpointHash'],'reviewer':'Codex independent trellis-check','reason':reason}
if action.startswith('reply:'):result.update(action='reply',replyId=action.split(':',1)[1])
elif action=='checked':assert p['kind']=='browser';result['checked']=True
else:assert action in ['advance','hold'];result['action']=action
if len(sys.argv)>4:
 flags=sys.argv[4].split(',');assert len(flags)==5
 mapped=[{'p':'pass','f':'fail','n':'not_applicable'}[f] for f in flags]
 fields=['mainRequirement','processFacts','finalFacts','effects','boundaries'];s=dict(zip(fields,mapped));s.update(id=expected,strict='fail' if 'fail'in mapped else 'pass',reason=sys.argv[5],quotes=json.loads(sys.argv[6]) if len(sys.argv)>6 else [],reviewer='Codex independent trellis-check',unnecessaryClarification=False)
 s['evidence']=[str(q.relative_to(base)) for q in sorted((base/expected/'gate').glob('*-checkpoint.json'))]+[str(q.relative_to(base)) for q in sorted((base/expected).glob('interaction-*.json')) if not q.name.endswith('-decision.json')]
 browser=out/(expected+'-browser.json')
 if browser.exists():
  b=json.loads(browser.read_text());assert b['stateUnchanged'];s['evidence'].append(browser.name)
 with open(out/(expected+'-score.json'),'x') as f:json.dump(s,f,ensure_ascii=False,indent=2);f.write('\n')
with open(p['decisionPath'],'x') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
print(expected,action,'recorded')
