"""Offline merge only: retain failed attempts; compare complete logical pairs separately."""
from pathlib import Path
import collections,json,sys
roots=[Path(arg).resolve() for arg in sys.argv[1:]]
if len(roots)<2:raise ValueError('Provide original and one or more continuation roots')
old_root=roots[0];resume_root=roots[-1]
def read(root,name):
 p=root/name
 return json.loads(p.read_text()) if p.exists() else []
metrics={};notifications={}
for root in roots:
 for row in read(root,'metrics.json'):
  assert row['run'] not in metrics,'duplicate actual run id'
  metrics[row['run']]={**row,'evidenceRoot':str(root/'evidence'/row['run'])}
 for row in read(root,'notification-scores.json'):
  assert row['run'] not in notifications,'duplicate notification run id'
  notifications[row['run']]=row
scores={}
for root in roots:
 for row in read(root,'semantic-scores.json'):scores[row['run']]=row
def full(name):
 r=metrics.get(name)
 return bool(r and r['publishedBatches']==r['plannedBatches']==12)
def aggregate(names):
 rows=[metrics[n] for n in names];ns=[notifications[n] for n in names if n in notifications];ss=[scores[n] for n in names if n in scores];usage=collections.Counter()
 for r in rows:usage.update(r['usage'])
 return {'runs':names,'runCount':len(names),'publishedBatches':sum(r['publishedBatches'] for r in rows),'coveredTaskRounds':sum(r['coveredTaskRounds'] for r in rows),'plannedTaskRounds':sum(53 if 'spatial' in n else 36 for n in names),'coreCorrect':sum(s['coreCorrect'] for s in ss),'evidenceCorrect':sum(s['evidenceCorrect'] for s in ss),'semanticScoredTaskRounds':sum(s.get('scoredTaskRounds',s['plannedTaskRounds']) for s in ss),'pendingScoreRuns':[n for n in names if n not in scores],'batchCorrect':sum(n['batchCorrect'] for n in ns),'batchScored':sum(n['batchScored'] for n in ns),'textTaskCorrect':sum(n['allTextTaskCorrect'] for n in ns),'textTaskScored':sum(n['allTextTaskScored'] for n in ns),'spatialRequiredTaskCorrect':sum(n['requiredTaskCorrect'] for n in ns),'spatialRequiredTaskScored':sum(n['requiredTaskScored'] for n in ns),'providerRequests':sum(r['providerRequests'] for r in rows),'toolCalls':sum(r['toolCalls'] for r in rows),'toolErrors':sum(r['toolErrors'] for r in rows),'repairPrompts':sum(r['repairPrompts'] for r in rows),'nativeCompactions':sum(r['nativeCompactions'] for r in rows),'durationSeconds':sum(r['durationSeconds'] for r in rows),'meanDurationSeconds':sum(r['durationSeconds'] for r in rows)/len(rows) if rows else None,'usage':dict(usage)}
pairs=[];unpaired=[]
for kind in ['text','spatial']:
 for repeat in [1,2,3]:
  a=f'old-{kind}-{repeat}';b=f'new-{kind}-{repeat}';resumed=b+'-resume'
  if resumed in metrics:b=resumed
  if full(a) and full(b):pairs.append({'scenario':kind,'repeat':repeat,'old':a,'new':b})
  else:unpaired.append({'scenario':kind,'repeat':repeat,'old':a,'new':b,'oldComplete':full(a),'newComplete':full(b)})
variants=[];pending_variants=[]
for kind in ['time-weight','source-conflict','shared-object']:
 a='old-variant-'+kind;b='new-variant-'+kind
 if b+'-complete' in metrics:b+='-complete'
 if full(a) and full(b):variants.append({'scenario':kind,'old':a,'new':b})
 else:pending_variants.append({'scenario':kind,'oldComplete':full(a),'newComplete':full(b)})
prefixes=[]
def raw_rows(name):
 data=json.loads(Path(scores[name]['source']).read_text())
 if isinstance(data,list):data=next(x for x in data if x.get('run')==name)
 return data['rows']
for kind in ['time-weight','source-conflict','shared-object']:
 a='old-variant-'+kind;b='new-variant-'+kind
 if full(a) and b in metrics and not full(b) and a in scores and b in scores:
  newrows=raw_rows(b);keys={(r['round'],r['task']) for r in newrows};oldrows=[r for r in raw_rows(a) if (r['round'],r['task']) in keys]
  assert len(oldrows)==len(newrows)
  prefixes.append({'scenario':kind,'old':a,'new':b,'exploratoryOnly':True,'includedInVariantMainAggregate':False,'taskRoundsEach':len(newrows),'rounds':sorted({r['round'] for r in newrows}),'oldCoreCorrect':sum(r['coreCorrect'] for r in oldrows),'newCoreCorrect':sum(r['coreCorrect'] for r in newrows),'oldEvidenceCorrect':sum(r['evidenceCorrect'] for r in oldrows),'newEvidenceCorrect':sum(r['evidenceCorrect'] for r in newrows),'remainingPlannedTaskRounds':36-len(newrows)})
result={'exploratoryPrefixes':prefixes,'originalPairs':pairs,'originalUnpaired':unpaired,'variantPairs':variants,'variantUnpaired':pending_variants,'original':{v:aggregate([p[v] for p in pairs]) for v in ['old','new']},'variants':{v:aggregate([p[v] for p in variants]) for v in ['old','new']},'semanticReviewNotes':{name:row.get('reviewMetadata',{}) for name,row in scores.items()},'allActualRuns':list(metrics),'incompleteActualRuns':[n for n in metrics if not full(n)],'allKnownUsage':dict(sum((collections.Counter(r['usage']) for r in metrics.values()),collections.Counter())),'allProviderRequests':sum(r['providerRequests'] for r in metrics.values()),'allUnknownUsageAttempts':sum(r['unknownUsageAttempts'] for r in metrics.values())}
(resume_root/'merged-metrics.json').write_text(json.dumps(list(metrics.values()),ensure_ascii=False,indent=2))
(resume_root/'merged-notification-scores.json').write_text(json.dumps(list(notifications.values()),ensure_ascii=False,indent=2))
(resume_root/'merged-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'originalPairs':len(pairs),'variantPairs':len(variants),'actualRuns':len(metrics),'incompleteActualRuns':result['incompleteActualRuns'],'pendingScores':{k:{v:result[k][v]['pendingScoreRuns'] for v in ['old','new']} for k in ['original','variants']}},ensure_ascii=False))
