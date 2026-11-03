import pathlib,json,shutil,hashlib,tarfile
root=pathlib.Path(__file__).resolve().parent
states=[entry for p in root.glob('*-status.json') for entry in json.loads(p.read_text())]
for entry in states:
 if entry['status']!='finished' or not entry.get('evidence'): continue
 src=pathlib.Path(entry['evidence']).parent; dst=root/'evidence'/entry['name'];dst.mkdir(parents=True,exist_ok=True)
 paths=[src/'validation.json',*src.glob('provider-request-*.json'),*src.glob('background/streams/*/*/sessions/*.jsonl')]
 for p in paths:
  out=dst/p.relative_to(src);out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,out)
 print(entry['name'],len(paths),'raw evidence files')
