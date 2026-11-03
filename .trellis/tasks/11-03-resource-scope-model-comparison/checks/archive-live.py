"""Offline evidence archive; no provider requests. Never copy raw data/credentials."""
import hashlib,json,tarfile,sys,re
from pathlib import Path
from datetime import datetime
batch=Path(sys.argv[1]);dest=Path(sys.argv[2]);dest.mkdir(parents=True,exist_ok=True)
secret_paths=[Path('/Users/lau/.codex/worktrees/agent-result-grounding/berserk/experiments/harness-lab/.env.local'),Path('/Users/lau/.codex/worktrees/agent-spatial-plotting/berserk/experiments/harness-lab/.env.qwen-bailian.local')]
secrets=[]
for p in secret_paths:
 for line in p.read_text().splitlines():
  if line.startswith('LLM_API_KEY='):
   value=line.split('=',1)[1].strip().strip('\"\'');assert value;secrets.append(value.encode())
for p in batch.glob('*/credentials.json'):
 for value in json.loads(p.read_text()).values():
  if isinstance(value,str) and len(value)>12:secrets.append(value.encode())
manifest=[];summary=[]
for slot in json.loads((batch/'schedule.json').read_text()):
 p=batch/slot['id'];rp=p/'result.json'
 if not rp.exists():continue
 result=json.loads(rp.read_text());members=[]
 for f in sorted(p.rglob('*')):
  if not f.is_file():continue
  rel=f.relative_to(p)
  if rel.parts[0]=='data' or rel.name=='credentials.json':continue
  data=f.read_bytes()
  assert not any(s in data for s in secrets),'credential bytes in selected evidence: '+str(rel)
  members.append((f,rel,data))
 target=dest/(slot['id']+'.tar.gz')
 if not target.exists():
  with tarfile.open(target,'w:gz') as tf:
   for f,rel,_ in members:tf.add(f,arcname=str(Path(slot['id'])/rel),recursive=False)
 filelist=[{'path':str(Path(slot['id'])/rel),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for _,rel,data in members]
 # Existing archive must match all retained evidence; refuse silently stale archives.
 with tarfile.open(target,'r:gz') as tf:
  for row in filelist:
   assert hashlib.sha256(tf.extractfile(row['path']).read()).hexdigest()==row['sha256']
 manifest.append({'slot':slot['id'],'archive':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':filelist})
 ledger=json.loads((batch/('ledger-'+slot['group']+'.json')).read_text());duration=0;requests=[]
 for a in ledger['attempts']:
  if a['trialId']!=slot['id']:continue
  mp=p/('provider-'+str(a['id']).zfill(4)+'-response-meta.json')
  elapsed=None
  if mp.exists():
   meta=json.loads(mp.read_text());elapsed=(datetime.fromisoformat(meta['at'])-datetime.fromisoformat(a['startedAt'])).total_seconds();duration+=elapsed
  requests.append({'id':a['id'],'status':a['status'],'elapsedSeconds':elapsed,'usage':a.get('usage')})
 summary.append({**result,'providerElapsedSeconds':duration,'nonProviderElapsedSeconds':result['wallMs']/1000-duration,'timeMeaning':'Provider interval includes HTTP/stream; remainder includes fixture/browser/hash/review waiting, not pure human time.','requests':requests})
(dest/'archive-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(dest/'execution-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
top_manifest=[]
for name in ['protocol.json','runtime-integrity.json','schedule.json','readiness.json','public-gate.json','ledger-A.json','ledger-B.json']:
 data=(batch/name).read_bytes(); assert not any(secret in data for secret in secrets), 'credential bytes in batch '+name
 (dest/name).write_bytes(data);top_manifest.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
(dest/'batch-manifest.json').write_text(json.dumps(top_manifest,ensure_ascii=False,indent=2))
print(json.dumps({'archivedSlots':len(manifest),'credentialScanPassed':True,'exclusions':['data/**','credentials.json']},ensure_ascii=False))
