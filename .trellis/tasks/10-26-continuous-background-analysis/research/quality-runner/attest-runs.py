from pathlib import Path
import json,hashlib,collections
root=Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text());config=json.loads((root/'public-config.json').read_text());out=[]
for p in sorted((root/'evidence').glob('*/review.json')):
 d=json.loads(p.read_text());params=collections.Counter()
 for f in p.parent.glob('provider-request-*.json'):
  req=json.loads(f.read_text());params[json.dumps({k:v for k,v in req.items() if k not in ['messages','tools']},sort_keys=True)]+=1
 out.append({'run':p.parent.name,'sourceRevision':d['sourceRevision'],'fixtureHash':d['fixtureHash'],'runnerHash':d['runnerHash'],'publicConfig':config,'observedRequestParameterSets':[{'parameters':json.loads(k),'requests':v} for k,v in params.items()]})
(root/'run-attestations.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps([{'run':d['run'],'sourceRevision':d['sourceRevision'],'fixtureHash':d['fixtureHash'],'parameterSets':len(d['observedRequestParameterSets'])} for d in out],ensure_ascii=False,indent=2))
