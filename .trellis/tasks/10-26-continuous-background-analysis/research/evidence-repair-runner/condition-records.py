from pathlib import Path
import json,re,collections
root=Path(__file__).resolve().parent
for p in sorted((root/'evidence').glob('*/review.json')):
 d=json.loads(p.read_text());rows=[]
 for s in d['steps']:
  if s.get('publication')!='published':continue
  n=int(re.match(r'R(\d+)',s['name']).group(1))
  for t in s['update']['taskUpdates']:
   key=d['taskKeys'][t['taskId']]
   for c in t['assessment']['conditions']:
    rows.append({'round':n,'task':key,'jobId':s['jobId'],**c,'review':'pending','reviewReason':''})
 (p.parent/'condition-records.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
 text=['# '+p.parent.name+' 条件逐项审查','']
 for c in rows:text.extend([f"R{c['round']} {c['task']} {c['id']} {c['name']} | {c['before']} → {c['status']} | {c['change']} | {c['kind']} | important={c['significant']}",c['reason'],'引用：'+json.dumps(c['evidence'],ensure_ascii=False),''])
 (p.parent/'condition-records.md').write_text('\n'.join(text))
 print(p.parent.name,len(rows),dict(collections.Counter(r['change'] for r in rows)))
