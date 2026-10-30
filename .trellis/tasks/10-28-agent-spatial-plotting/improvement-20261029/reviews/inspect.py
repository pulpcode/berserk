import json,sys,hashlib,time
from pathlib import Path
base=Path('.local/agent-spatial-plotting-improvement-20261029/live')
def read(p):return json.loads(Path(p).read_text())
if '--wait' in sys.argv:
 sys.argv.remove('--wait')
 for _ in range(40):
  try:
   q=read(base/'pending.json')
   if not q.get('decisionPath') or not Path(q['decisionPath']).exists():break
  except FileNotFoundError:pass
  time.sleep(.5)
def brief(x,k=''):
 if k=='coordinates' and len(json.dumps(x))>350:return {'omitted_coordinates':True,'sha256':hashlib.sha256(json.dumps(x,separators=(',',':')).encode()).hexdigest()}
 if isinstance(x,dict):return {a:brief(b,a) for a,b in x.items() if a not in ['hash','createdAt','updatedAt','workspaceId','taskId','ownerSessionId','sessionId','viewId']}
 if isinstance(x,list):return [brief(v) for v in x]
 return x
if len(sys.argv)>1:
 p=base/sys.argv[1]/'review.json';x=read(p);e=x;entry=p.parent
 print('ENTRY',sys.argv[1])
else:
 pending=read(base/'pending.json')
 if pending.get('decisionPath') and Path(pending['decisionPath']).exists():
  print('WAITING_NEXT',[(r['id'],r['status']) for r in read(base/'runs.json') if r['status']=='started']);sys.exit()
 print('PENDING',json.dumps(pending,ensure_ascii=False))
 if pending['kind']=='interaction':
  x=read(pending['evidencePath']);print(json.dumps(x,ensure_ascii=False,indent=2));sys.exit()
 if pending['kind']!='ending':sys.exit()
 p=Path(pending['checkpointPath']);x=read(p);e=x['evidence'];entry=p.parent.parent
 print('PROMPT',x['prompt'])
for m in e['snapshot']['messages']:
 if len(sys.argv)==1 and x.get('index',1)>1 and m.get('requestId')!=e['requestId']:continue
 role=m['role'];name=m.get('toolName','');t=m.get('text','')
 if name in ['skill_read','skill.read']:
  print('SKILL',t[:100]);continue
 if role=='tool':
  try:t=json.dumps(brief(json.loads(t)),ensure_ascii=False)
  except:pass
 print(role,name,t)
print('MAP',json.dumps(brief(e['mapState']),ensure_ascii=False))
attempts=read(base/'attempts.json')
for a in attempts:
 if a['entry']==entry.name and (len(sys.argv)>1 or a['turn']==x.get('index',a['turn'])):print('TOOLS',a['id'],json.dumps(a['tools'],ensure_ascii=False))
if 'interactions'in x:print('INTERACTIONS',json.dumps(brief(x['interactions']),ensure_ascii=False))
