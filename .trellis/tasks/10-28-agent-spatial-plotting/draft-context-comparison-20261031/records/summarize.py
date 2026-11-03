"""Summarize reviewed scores without mutating execution or independent reviews."""
import json, hashlib
from pathlib import Path
from collections import Counter
root=Path(__file__).resolve().parent.parent
repo=root.parents[3]
batch=repo/'.local/draft-context-comparison-20261031/main'
read=lambda p:json.loads(p.read_text())
write=lambda p,x:p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
index={x['slotId']:x for x in read(root/'records/public-export-index.json')}
schedule=read(root/'schedule.json')['slots']
metrics=['scope_pass','geometry_and_members_pass','main_pass','process_facts_pass','final_facts_pass','no_business_effects_pass','strict_pass']
overrides={
 'V17':'按完整重名段落，前句明确限定本会话6个点；后续只/同名可沿用已读对象范围，不足以确定为全来源穷尽断言。表达仍不严谨；来源候选未处理继续判主任务失败。',
 'V20':'与V17同口径：6个点的限定贯穿重名说明，不将唯一同名最宽解释成已核实所有来源资源；记录措辞问题，范围遗漏不豁免。',
 'V21':'attributes在说明可用数量时可理解为属性泛称；实际值与availableCount字段正确，未提供API调用路径，不据此单独判确定事实错误。建议直接写来源属性。',
}
final=[]
for s in schedule:
 i=index[s['slotId']];path=root/'review/blind-scores'/f"{i['reviewId']}.json";original=read(path);x=dict(original)
 assert x['strict_pass']==all(x[k] for k in ['main_pass','process_facts_pass','final_facts_pass','no_business_effects_pass'])
 x.update(slotId=s['slotId'],group=s['group'],repeat=s['repeat'],independentScoreSha256=hashlib.sha256(path.read_bytes()).hexdigest())
 if i['reviewId'] in overrides:
  x['rootAdjudication']={'field':'final_facts_pass','original':x['final_facts_pass'],'final':True,'reason':overrides[i['reviewId']]}
  x['wordingNotes']=x['final_fact_errors']
  x['rootAdjudication']['originalFailureTags']=x['failureTags']
  x['failureTags']=[t for t in x['failureTags'] if t not in ['unsupported_exhaustive_homonym_claim','wrong_property_container']]
  x['final_facts_pass']=True;x['final_fact_errors']=[]
 x['strict_pass']=all(x[k] for k in ['main_pass','process_facts_pass','final_facts_pass','no_business_effects_pass'])
 x['ended_with_default_draft']=x['default_draft_end']
 x['ended_with_default_source']=x['default_source_end']
 x['aware_of_other_source_left_optional']=x['other_source_optional']
 final.append(x)
assert len(final)==32
attempts=read(batch/'attempts.json')
def stats(rows):
 return {'total':len(rows),**{k:sum(bool(x[k]) for x in rows) for k in metrics},'skillReadTasks':sum(bool(x['skills']) for x in rows),'effectiveClarifications':sum(x['effectiveClarifications'] for x in rows),'defaultDraftEnd':sum(x['default_draft_end'] for x in rows),'defaultSourceEnd':sum(x['default_source_end'] for x in rows)}
groups={}
for g in ['A','B']:
 rows=[x for x in final if x['group']==g];a=[x for x in attempts if x['group']==g]
 groups[g]={**stats(rows),'primary':stats([x for x in rows if x['caseId'] in ['G05','G06','G07','G08']]),'repeat':{str(r):stats([x for x in rows if x['repeat']==r]) for r in [1,2]},'usage':{'requests':len(a),'input':sum(x['usage']['input'] for x in a),'output':sum(x['usage']['output'] for x in a),'reasoningTokens':sum(x.get('reasoningTokens',0) or 0 for x in a),'elapsedMs':sum(x['elapsedMs'] for x in a)}}
pairs=[]
for case in sorted({x['caseId'] for x in final}):
 for r in [1,2]:
  a=next(x for x in final if x['caseId']==case and x['repeat']==r and x['group']=='A');b=next(x for x in final if x['caseId']==case and x['repeat']==r and x['group']=='B')
  pairs.append({'caseId':case,'repeat':r,'A_main':a['main_pass'],'B_main':b['main_pass'],'A_strict':a['strict_pass'],'B_strict':b['strict_pass'],'mainOutcome':'both_pass' if a['main_pass'] and b['main_pass'] else 'B_better' if b['main_pass'] else 'B_worse' if a['main_pass'] else 'both_fail'})
summary={'planned':32,'completed':32,'scored':32,'groups':groups,'overall':stats(final),'pairs':pairs,'pairOutcomes':dict(Counter(x['mainOutcome'] for x in pairs)),'adjudications':overrides,'factErrorSlots':[x['slotId'] for x in final if not x['final_facts_pass'] or not x['process_facts_pass']]}
write(root/'records/final-scores.json',final);write(root/'records/scores-summary.json',summary)
for name in ['runs.json','budget.json','ledger.json','attempts.json','protocol.json','batch-state.json','process-gate-decision.json']:
 write(root/'records'/('execution-'+name),read(batch/name))
print(json.dumps({'groups':groups,'pairs':summary['pairOutcomes'],'facts':summary['factErrorSlots']},ensure_ascii=False,indent=2))
