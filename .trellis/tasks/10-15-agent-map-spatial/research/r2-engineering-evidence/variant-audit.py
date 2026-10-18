import json,hashlib
from pathlib import Path
root=Path('/Users/lau/.codex/worktrees/agent-map-spatial/berserk')
b=root/'.local/spatial-r2/preflight-20261018-b'
r=json.loads((b/'runs.json').read_text())
assert len(r)==48 and all(x['status']=='prepared' for x in r)
assert json.loads((b/'attempts.json').read_text())==[]
checks=[]
for case in ['V02','V04','V09','V12']:
 docs=[]
 for group in ['baseline','map-only','spatial-only']:
  f=json.loads((b/f'{case}-{group}'/'fixture.json').read_text());doc=f['before']['version']['document'];docs.append(doc);layers={l['layerId']:l for l in doc['layers']}
  if case=='V02':
   l=layers['lyr-k72'];assert l['name']=='沿岸补给' and len(l['features'])==58
   assert [x['name'] for x in l['features'][50:52]]==['桦林补给站','石湾补给站']
  if case=='V04':
   poly=next(f for l in doc['layers'] for f in l['features'] if f['objectId']=='region')['geometry']['coordinates'][0]
   xs=[p[0] for p in poly];ys=[p[1] for p in poly]
   inside=[f['objectId'] for f in layers['resources']['features'] if min(xs)<=f['geometry']['coordinates'][0]<=max(xs) and min(ys)<=f['geometry']['coordinates'][1]<=max(ys)]
   assert inside==['r1','r2','r3','edge']
  if case=='V09':
   assert layers['resources-other']['order']<layers['resources']['order']
   assert layers['resources-other']['name']==layers['resources']['name']=='保障资源'
   assert layers['resources-other']['features'][0]['geometry']['coordinates']==[114,22.55]
  if case=='V12':
   cats=[f.get('attributes',{}).get('category') for f in layers['resources']['features']]
   assert cats.count('sensor')==3 and cats.count('supply')==1 and cats.count(None)==1
  checks.append(f'{case}-{group}')
 assert docs[0]==docs[1]==docs[2],case
protocol=json.loads((b/'protocol.json').read_text())
for path,h in protocol['hashes'].items():
 p=root/path if path!='r2-execution-plan-20261018.md' else root/'.trellis/tasks/10-15-agent-map-spatial/r2-execution-plan-20261018.md'
 assert hashlib.sha256(p.read_bytes()).hexdigest()==h,path
result={'prepared':48,'providerAttempts':0,'variantIndependentChecks':checks,'identicalWithinCaseGroups':True,'frozenSourceMatches':True,'sourceHashCount':len(protocol['hashes'])}
Path('/private/tmp/r2-preflight-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
