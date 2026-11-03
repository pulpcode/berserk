from pathlib import Path
import json,re
root=Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text())
fixtures={digest:name for name,digest in {**manifest['inputHashes'],**manifest.get('variantInputHashes',{})}.items()}
out=[]
for p in sorted((root/'evidence').glob('*/review.json')):
 d=json.loads(p.read_text());name=p.parent.name;ids=d['taskKeys']
 fixture=fixtures.get(d['fixtureHash'])
 if fixture is None:raise ValueError('No frozen notification oracle for fixture: '+d['fixtureHash'])
 spatial=fixture=='spatial-multi-task-input.json';originalText=fixture=='multi-task-input.json'
 rubric=fixture.removesuffix('-input.json')+'-v1'
 if spatial:expected={1:True,2:True,3:True,5:True,6:True,7:False,10:True,12:True};required={1:['A','C'],2:['E'],3:['C','E'],5:['A'],6:['C'],10:['C','D'],12:['C','D']}
 else:
  expected={n:n not in [7,8] for n in [1,2,3,5,6,7,8,9,10,11,12]};required={}
  if fixture=='time-weight-input.json':expected[8]=True
  if fixture=='source-conflict-input.json':expected[7]=expected[8]=True
  if fixture=='shared-object-input.json':expected[8]=True;expected[10]=expected[11]=False
 rows=[];taskrows=[];alltaskrows=[]
 expectedText={1:["A"],2:["A"],3:["A"],5:["A"],6:["A"],7:[],8:[],9:["C"],10:["B"],11:["B"],12:["C"]}
 for s in d['steps']:
  n=int(re.match(r'R(\d+)',s['name']).group(1));published=s.get('publication')=='published'
  if n in expected:rows.append({'round':n,'expected':expected[n],'actual':bool(s.get('deliveries')) if published else None,'passed':bool(s.get('deliveries'))==expected[n] if published else None})
  if originalText and n in expectedText:
   for task in ['A','B','C']:
    update=next((u for u in (s.get('update') or {}).get('taskUpdates',[]) if ids.get(u['taskId'])==task),None)
    want=task in expectedText[n];actual=update.get('significant') if update else None
    alltaskrows.append({'round':n,'task':task,'expected':want,'actual':actual,'passed':actual is not None and bool(actual)==want if published else None})
  for task in required.get(n,[]):
   update=next((u for u in (s.get('update') or {}).get('taskUpdates',[]) if ids.get(u['taskId'])==task),None)
   taskrows.append({'round':n,'task':task,'actual':update.get('significant') if update else None,'passed':bool(update and update.get('significant')) if published else None})
 out.append({'run':name,'fixture':fixture,'fixtureHash':d['fixtureHash'],'rubric':rubric,'taskScoringScope':'original_text_full' if originalText else 'spatial_required' if spatial else 'variant_batch_only','batchCorrect':sum(r['passed'] is True for r in rows),'batchScored':sum(r['passed'] is not None for r in rows),'unpublishedAttemptedBatchChecks':sum(r['passed'] is None for r in rows),'batchPlanned':len(expected),'rows':rows,'requiredTaskCorrect':sum(r['passed'] is True for r in taskrows),'requiredTaskScored':sum(r['passed'] is not None for r in taskrows),'requiredTaskPlanned':sum(map(len,required.values())),'taskRows':taskrows,'allTextTaskCorrect':sum(r['passed'] is True for r in alltaskrows),'allTextTaskScored':sum(r['passed'] is not None for r in alltaskrows),'allTextTaskPlanned':33 if originalText else 0,'allTextTaskRows':alltaskrows})
(root/'notification-scores.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps([{k:v for k,v in x.items() if k not in ['rows','taskRows','allTextTaskRows']} for x in out],ensure_ascii=False,indent=2))
