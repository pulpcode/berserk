import json,sys
from pathlib import Path
p=Path(sys.argv[1]); x=json.loads(p.read_text()); e=x['evidence']
print('HASH',x['evidenceHash'],'PATH',x['decisionPath'])
print('OBSERVED',json.dumps(e.get('observed'),ensure_ascii=False))
print('FACTS',json.dumps(e.get('humanFacts'),ensure_ascii=False))
print('INTERACTION',json.dumps(e.get('interaction'),ensure_ascii=False))
for m in e.get('snapshot',{}).get('messages',[]):
 if m.get('role')=='assistant':print('ASSISTANT',m.get('text'))
 elif m.get('role')=='user':print('USER',m.get('text'))
 else:print('TOOL',m.get('toolName'), 'error',m.get('isError'), 'missing',m.get('resultMissing'))
