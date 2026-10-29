from pathlib import Path
import json,datetime,collections
root=Path(__file__).resolve().parent
out=[]
for p in sorted((root/'evidence').glob('*/review.json')):
 d=json.loads(p.read_text());rows=d['steps'];usage=collections.Counter();unknown=0
 for s in rows:
  u=s.get('usage') or {};usage.update(u.get('actual',{}));unknown+=u.get('unknownUsageAttempts',0)
 audits=[json.loads(s) for s in (root/'logs'/(p.parent.name+'-provider.jsonl')).read_text().splitlines()]
 native=list(p.parent.glob('background/streams/*/*/sessions/*.jsonl'));compactions=0;models=set();providers=set();max_input=0;reasoning=0;tools=collections.Counter();failedModels=set()
 for f in native:
  for line in f.open():
   x=json.loads(line);compactions+=x.get('type')=='compaction';m=x.get('message',{})
   if m.get('role')=='assistant':
    for block in m.get('content',[]):
     if isinstance(block,dict) and block.get('type')=='toolCall':tools[block.get('name','unknown')]+=1
    if m.get('stopReason')=='error':failedModels.add(m.get('model'))
    else:models.add(m.get('responseModel') or m.get('model'))
    providers.add(m.get('provider'));u=m.get('usage',{});reasoning+=u.get('reasoning',0);max_input=max(max_input,u.get('input',0)+u.get('cacheRead',0)+u.get('cacheWrite',0))
 published=[s for s in rows if s.get('publication')=='published']
 out.append({'run':p.parent.name,'version':p.parent.name.split('-')[0],'durationSeconds':round((datetime.datetime.fromisoformat(d['endedAt'])-datetime.datetime.fromisoformat(d['startedAt'])).total_seconds(),2),'publishedBatches':len(published),'attemptedBatches':sum(bool(s.get('jobId')) for s in rows),'plannedBatches':12,'coveredTaskRounds':sum(len((s.get('update') or {}).get('taskCoverage',[])) for s in published),'recordedTaskUpdates':sum(len((s.get('update') or {}).get('taskUpdates',[])) for s in published),'providerRequests':d.get('providerRequestCount'),'repairPrompts':sum(len(s.get('repairs',[])) for s in rows),'toolErrors':sum(len(s.get('errors',[])) for s in rows),'unknownUsageAttempts':unknown,'usage':dict(usage),'mechanismChecksPassed':d['mechanismChecksPassed'],'failure':d.get('failure'),'nativeSessions':len(native),'nativeCompactions':compactions,'maxInputTokensPerRequest':max_input,'actualResponseModels':sorted(models),'configuredModelsOnFailedAttempts':sorted(failedModels),'nativeProviders':sorted(providers),'nativeReasoningTokens':reasoning,'toolCalls':sum(tools.values()),'toolCallsByName':dict(tools),'audit':{'requests':len(audits),'allExactArkUrl':all(a.get('url')==a.get('responseUrl')=='https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions' for a in audits),'statuses':dict(collections.Counter(str(a.get('status')) for a in audits))}})
(root/'metrics.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False,indent=2))
