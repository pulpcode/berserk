"""Read-only raw evidence verification; no model calls and no semantic auto-grading."""
import json, hashlib, math
from pathlib import Path
root=Path(__file__).resolve().parents[4]
batch=root/'.local/spatial-r7/batch-20261023'
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
rows=read(batch/'runs.json'); attempts=read(batch/'attempts.json'); checked=0; out=[]
for r in rows:
 p=batch/r['id'];d=read(p/'review.json')
 for name,h in read(p/'evidence-hashes.json').items():
  assert sha(p/name)==h,(r['id'],name);checked+=1
 before=d['fixture']['before'];after=d['after'];saved=None
 if r['caseId']!='D16':assert before==after
 else:
  assert before['publications']==after['publications'] and before['current']==after['current']
  old=before['version']['document'];new=json.loads(json.dumps(after['version']['document']))
  originals={f['objectId'] for l in old['layers'] for f in l['features']}
  added=[f for l in new['layers'] for f in l['features'] if f['objectId'] not in originals]
  assert len(added)==1 and added[0]['name']=='临时范围'
  first=next(m['spatialResult']['geometry'] for m in d['final']['messages'] if m.get('spatialResult',{}).get('operation')=='buffer')
  assert first==added[0]['geometry']
  for l in new['layers']:l['features']=[f for f in l['features'] if f['objectId'] in originals]
  expected=json.loads(json.dumps(old))
  assert d['conflictInjected']
  for l in expected['layers']:
   for f in l['features']:
    if f['objectId']=='origin':f['note']='外部已核实，请保留'
  assert expected==new
  saved={'exactFirstGeometry':True,'externalNotePreserved':True,'conflictInjected':True}
 selected=read(p/'resources.json')['selection']['id'];exposures=[]
 for f in sorted(p.glob('provider-*-loading.json')):
  e=read(f);assert e['skills'][selected]['bodyPresent'];exposures.append(e)
 wire=[]
 for f in p.glob('provider-*-wire-input.json'):
  w=read(f);o=read(Path(str(f).replace('-wire-input','-input')))
  assert w==dict(o,thinking={'type':'disabled'});assert w['model']=='deepseek-v4.1-flash';wire.append(w)
 out.append({'entryId':r['id'],'status':r['status'],'messages':len(d['final']['messages']),'visibleMessages':[i for i,m in enumerate(d['final']['messages']) if m['role']=='assistant' and m.get('text')],'allSelectedBodiesPresent':True,'providerCalls':len(wire),'stateUnchanged':before==after,'save':saved})
assert len(rows)==12 and all(r['status']=='recorded' for r in rows)
assert len(attempts)==53 and all(a['status']==200 and a['completed'] and a['actualModels']==['deepseek-v4-1-flash-261017'] for a in attempts)
groups={}
for g in ['A','B']:
 aa=[a for a in attempts if a['entry'].endswith('-'+g)]
 groups[g]={'requests':len(aa),'input':sum(a['usage']['prompt_tokens'] for a in aa),'output':sum(a['usage']['completion_tokens'] for a in aa),'tools':sum(r['tools'] for r in rows if r['group']==g),'elapsedMs':sum(r['elapsedMs'] for r in rows if r['group']==g)}
report={'batch':str(batch.relative_to(root)),'rawEvidenceFilesVerified':checked,'requests':len(attempts),'responseModel':'deepseek-v4-1-flash-261017','groups':groups,'rows':out,'scope':'deterministic evidence audit, semantic review separate'}
(root/'.trellis/tasks/10-15-agent-map-spatial/research/r7-audit-20261023.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'files':checked,'groups':groups},ensure_ascii=False))
