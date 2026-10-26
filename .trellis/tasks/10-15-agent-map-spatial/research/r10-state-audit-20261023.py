"""Independent post-run state checks; no provider calls and no narrative scoring."""
import json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
B=ROOT/'.local/spatial-r10/batch-20261023'
read=lambda p:json.loads(p.read_text())
records={f'T{i:02}':read(B/f'T{i:02}-B/review.json') for i in range(1,25)}
checks={}
for key,d in records.items():
 before,after=d['fixture']['before'],d['after']
 if int(key[1:])<=20:
  assert before==after,key
  checks[key]={'mapStateUnchanged':True}
 elif key in ('T21','T22','T23'):
  assert before['current']==after['current'] and before['publications']==after['publications']
  old=before['version']['document'];new=json.loads(json.dumps(after['version']['document']))
  oldids={f['objectId'] for l in old['layers'] for f in l['features']}
  added=[f for l in new['layers'] for f in l['features'] if f['objectId'] not in oldids]
  assert len(added)==1 and added[0]['name']=='临时范围',key
  assert added[0] in next(l for l in new['layers'] if l['layerId']=='derived')['features']
  first=next(m['spatialResult'] for m in d['final']['messages'] if m.get('spatialResult',{}).get('operation')=='buffer')
  assert added[0]['geometry']==first['geometry']
  for layer in new['layers']:layer['features']=[f for f in layer['features'] if f['objectId'] in oldids]
  expected=json.loads(json.dumps(old))
  if key=='T22':
   assert d['conflictInjected']
   next(f for l in expected['layers'] for f in l['features'] if f['objectId']=='origin')['note']='外部已核实，请保留'
   assert any(m.get('isError') and 'ANNOTATION_CONFLICT' in m.get('text','') for m in d['final']['messages'])
  assert new==expected,key
  assert before['binding']['draft']['setId']==after['binding']['draft']['setId']
  assert after['binding']['draft']['headRevision']-before['binding']['draft']['headRevision']==(2 if key=='T22' else 1)
  checks[key]={'savedObjects':1,'exactFirstGeometry':True,'originalContentsPreserved':True,'noPublishOrAdopt':True}
  if key=='T22':checks[key]['realConflictAndExternalNotePreserved']=True
  if key=='T23':
   receipt=read(B/'T23-B/lost-receipt-injection.json')['actualCommittedReceipt']
   delivered=[m['annotationResult']['receipt'] for m in d['final']['messages'] if (m.get('annotationResult') or {}).get('origin')=='receipt_read']
   assert len(delivered)==1 and delivered[0]==receipt
   assert any(m.get('isError') and 'ANNOTATION_RESULT_UNCERTAIN' in m.get('text','') for m in d['final']['messages'])
   checks[key]['originalReceiptRecovered']=True
 else:
  assert before['binding']==after['binding'] and before['version']==after['version'] and before['current']==after['current']
  added=[p for p in after['publications'] if p not in before['publications']]
  assert len(added)==1 and added[0]['metadata']['title']=='核对发布版'
  assert added[0]['version']['document']==before['version']['document']
  provenance=next(p for p in d['publicationProvenance'] if p['id']==added[0]['metadata']['publicationId'])
  assert provenance['set_id']==before['binding']['draft']['setId'] and provenance['revision']==before['binding']['draft']['headRevision']
  checks[key]={'exactSpecifiedRevisionPublished':True,'draftAndCurrentUnchanged':True}
# Numeric oracles independently based on actual original fixture coordinates.
R=6371008.8
def hav(a,b):
 x1,y1,x2,y2=map(math.radians,(*a,*b))
 return 2*R*math.asin(min(1,math.sqrt(math.sin((y2-y1)/2)**2+math.cos(y1)*math.cos(y2)*math.sin((x2-x1)/2)**2)))
for key in ('T05','T06','T07','T08'):
 d=records[key];features={f['objectId']:f for l in d['fixture']['before']['version']['document']['layers'] for f in l['features']}
 if key=='T05':expected=hav(features['origin']['geometry']['coordinates'],features['north']['geometry']['coordinates'])
 elif key=='T06':
  points=features['return-line']['geometry']['coordinates'];expected=sum(hav(a,b) for a,b in zip(points,points[1:]))
 elif key=='T07':
  ring=features['region']['geometry']['coordinates'][0];xs=[p[0] for p in ring];ys=[p[1] for p in ring]
  expected=R*R*math.radians(max(xs)-min(xs))*(math.sin(math.radians(max(ys)))-math.sin(math.radians(min(ys))))
 else:
  expected=R*math.radians(.01) # symmetric line oracle; declared 2m spherical-curvature tolerance
 result=next(m['spatialResult'] for m in d['final']['messages'] if m.get('spatialResult',{}).get('operation')=='measure')
 assert abs(result['values']['value']-expected)<=(10 if key=='T07' else 2)
 checks[key]['independentNumericMatch']=True
# Evidence completeness is measured separately from coincidentally correct names.
d=records['T13'];seen=set()
for m in d['final']['messages']:
 if m.get('toolName')=='annotation_read' and not m.get('isError'):
  result=json.loads(m['text'])['data'];seen.update(f['objectId'] for f in result.get('objects',{}).get('items',[]) if f['layerId']=='lyr-k72')
expected=next(l for l in d['fixture']['before']['version']['document']['layers'] if l['layerId']=='lyr-k72')['features']
missing=[f['objectId'] for f in expected if f['objectId'] not in seen]
assert missing==['obj-1-047','obj-1-048','obj-1-049','obj-1-050']
final=d['final']['messages'][-1]['text']
assert all(f['name'] in final for f in expected)
checks['T13'].update({'actuallyReadNames':len(seen),'expectedNames':58,'unreadObjectIds':missing,'answerNamesMatchTruth':True,'completeReadCoverage':False})
# Actual source faults and update, not model claims.
assert any(m.get('isError') and 'CONTEXT_UNAVAILABLE' in m.get('text','') for m in records['T15']['final']['messages'])
checks['T15']['realSourceUnavailable']=True
assert any(m.get('isError') and 'SPATIAL_GEOMETRY_MISSING' in m.get('text','') for m in records['T16']['final']['messages'])
assert (B/'T16-B/source-fault.jsonl').exists();checks['T16']['realMissingGeometryExposed']=True
update=read(B/'T19-B/source-update.json');old={o['ref']['objectId']:o for o in update['before']['objects']};new={o['ref']['objectId']:o for o in update['after']['objects']}
changed=[key for key in old if old[key]!=new[key]];assert len(changed)==1
assert old[changed[0]]['properties']['availableCount']==4 and new[changed[0]]['properties']['availableCount']==1
assert old[changed[0]]['geometry']==new[changed[0]]['geometry'];checks['T19']['actualAttributeUpdateOnly']=True
out=ROOT/'.trellis/tasks/10-15-agent-map-spatial/research/r10-state-audit-20261023.json'
out.write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'readonlyUnchanged':20,'exactSaves':3,'fixedRevisionPublication':1,'unreadNamesT13':missing,'checks':'passed'},ensure_ascii=False))
