from pathlib import Path
import json,hashlib,tarfile
root=Path(__file__).resolve().parent
out=root/'archives';out.mkdir(exist_ok=True)
records=[]
for d in sorted((root/'evidence').iterdir()):
 if not d.is_dir() or not (d/'review.json').exists():continue
 p=out/(d.name+'.tar.gz')
 if not p.exists():
  with tarfile.open(p,'w:gz') as tar:
   tar.add(d,arcname=d.name)
   for suffix in ['.log','-provider.jsonl']:
    f=root/'logs'/(d.name+suffix)
    if f.exists():tar.add(f,arcname=d.name+'/logs/'+f.name)
 records.append({'run':d.name,'file':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
(root/'archive-index.json').write_text(json.dumps(records,indent=2))
print(json.dumps(records,indent=2))
