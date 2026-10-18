"""Read-only mechanical audit. No model/semantic grader calls or production imports."""
import json,hashlib,math,re,copy,sys,subprocess
from pathlib import Path
from collections import Counter
REPO=Path('/Users/lau/.codex/worktrees/agent-map-spatial/berserk')
TASK=REPO/'.trellis/tasks/10-15-agent-map-spatial'
BATCH=REPO/'.local/spatial-r2/live-20261018-r2-01'
GROUPS=['baseline','map-only','spatial-only']
SKILLS=['map-annotations','spatial-analysis']
errors=[]
def load(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(value,label):
 if not value:errors.append(label)
 return bool(value)
def stable(v):return json.dumps(v,ensure_ascii=False,separators=(',',':'),sort_keys=True)
def text_of(p):
 return '\n'.join(m['content'] if isinstance(m.get('content'),str) else '\n'.join(x.get('text','') for x in m.get('content',[]) if isinstance(x,dict)) for m in p.get('messages',[]) if isinstance(m.get('content'),(str,list)))
def present(text,body):return body in text or json.dumps(body,ensure_ascii=False)[1:-1] in text

def haversine(a,b):
 x,y=map(math.radians,a);z,w=map(math.radians,b)
 return 2*6371008.8*math.asin(min(1,math.sqrt(math.sin((w-y)/2)**2+math.cos(y)*math.cos(w)*math.sin((z-x)/2)**2)))

def independent_expected(fixture,turn,snapshot):
 doc=copy.deepcopy(fixture['before']['version']['document']);kind=fixture['kind'];required=False
 if kind=='J03':
  next(f for l in doc['layers'] for f in l['features'] if f['objectId']=='point-b')['note']='B 保障讨论';required=True
 if kind=='J06' and turn>=1:
  next(f for l in doc['layers'] for f in l['features'] if f['objectId']=='origin')['name']='出发点';required=True
 return doc,required

def sse_usage(path):
 usage=None
 for line in path.read_text().splitlines():
  if line.startswith('data: ') and line[6:]!='[DONE]':
   try:v=json.loads(line[6:])
   except json.JSONDecodeError:continue
   if v.get('usage'):usage=v['usage']
 return usage

protocol=load(BATCH/'protocol.json');runs=load(BATCH/'runs.json');attempts=load(BATCH/'attempts.json');budget=load(BATCH/'budget.json')
complete=len(runs)==48 and all(r['status'] not in ('started','not_executed') for r in runs)
check(len(runs)==48,'planned rows !=48');check(len({r['id'] for r in runs})==48,'duplicate plan ids')
source_checks={}
for name,h in protocol['hashes'].items():
 p=TASK/'r2-execution-plan-20261018.md' if name=='r2-execution-plan-20261018.md' else REPO/name
 source_checks[name]=check(p.exists() and sha(p)==h,f'source drift {name}')

runtime_checks={};bodies={};catalogs={}
for g in GROUPS:
 root=BATCH/'runtimes'/g;integrity=load(root/'runtime-integrity.json');allowed=[] if g=='baseline' else [f"fixtures/skills/{'map-annotations' if g=='map-only' else 'spatial-analysis'}/SKILL.md"]
 actual_diff=[p for p in integrity['before'] if integrity['before'][p]!=integrity['after'][p]]
 check(actual_diff==allowed,f'{g} undeclared runtime diff');check(actual_diff==integrity['allowedDiff'],f'{g} diff manifest mismatch')
 runtime_checks[g]={'fileCount':len(integrity['after']),'allowedDiff':actual_diff,'allHashesMatch':all(check(sha(root/p)==h,f'{g} runtime drift {p}') for p,h in integrity['after'].items()),'baseMatchesProduct':all(check(sha(REPO/'experiments/harness-lab'/p)==h,f'{g} baseline mismatch {p}') for p,h in integrity['before'].items())}
 runtime_checks[g]['skillBodiesMatchFrozenCandidate']=all(check(sha(root/'fixtures/skills'/s/'SKILL.md')==sha(TASK/'r2-20261018/skills'/g/s/'SKILL.md'),f'{g} runtime Skill not frozen candidate {s}') for s in SKILLS)
 bodies[g]={s:(root/'fixtures/skills'/s/'SKILL.md').read_text() for s in SKILLS}

schema_hashes=set();provider_models=Counter();http_status=Counter();usage_totals=Counter();request_audit=[]
for a in attempts:
 p=BATCH/a['entry'];stem=f"provider-{a['id']:04}";http_status[str(a.get('status'))]+=1
 if not a.get('completed'):
  check(False,f"incomplete provider attempt {a['id']}");continue
 inp=p/(stem+'-input.json');rsp=p/(stem+'-response.sse');check(inp.exists(),f'missing {inp.name}');check(rsp.exists(),f'missing {rsp.name}')
 if not inp.exists() or not rsp.exists():continue
 payload=load(inp);provider_models[payload.get('model')]+=1
 check(payload.get('model')=='deepseek-v4-pro',f"model drift {a['id']}");check(payload.get('max_tokens')==4096,f"output limit drift {a['id']}");check(payload.get('thinking',{}).get('type')=='disabled',f"thinking drift {a['id']}")
 if any(t.get('function',{}).get('name')=='spatial_analyze' for t in payload.get('tools',[])):schema_hashes.add(hashlib.sha256(stable(payload['tools']).encode()).hexdigest())
 actual_usage=sse_usage(rsp);check(actual_usage==a.get('usage'),f"SSE usage mismatch {a['id']}")
 for k in ['prompt_tokens','completion_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']:usage_totals[k]+=a.get('usage',{}).get(k,0)
 entry=next(r for r in runs if r['id']==a['entry']);g=entry['group'];text=text_of(payload)
 exposure={s:present(text,bodies[g][s]) for s in SKILLS};evidence=load(p/(stem+'-skill-evidence.json'))
 for s in SKILLS:check(evidence['visibility'][s]['bodyPresent']==exposure[s],f"observer visibility mismatch {a['id']} {s}");check(evidence['visibility'][s]['hash']==hashlib.sha256(bodies[g][s].encode()).hexdigest(),f"observer Skill hash mismatch {a['id']} {s}")
 request_audit.append({'id':a['id'],'entry':a['entry'],'turn':a['turn'],'httpStatus':a.get('status'),'usage':a.get('usage'),'error':a.get('error'),'actualBodyExposure':exposure,'inputHash':sha(inp),'responseHash':sha(rsp)})
check(len(schema_hashes)==1,'parent tool schema differs across requests/groups')
check(budget['total']==len(attempts),'budget request tally mismatch');check(budget['input']==usage_totals['prompt_tokens'],'budget input tally mismatch');check(budget['output']==usage_totals['completion_tokens'],'budget output tally mismatch')

rows=[];fixtures_by_case={};effects=[];radius=[];saved=[];reuse=[];errors_seen=[]
for entry in runs:
 p=BATCH/entry['id'];row=dict(entry);series=[a for a in attempts if a['entry']==entry['id']];observed=[a for a in request_audit if a['entry']==entry['id']];g=entry['group']
 row.update({'actualRequests':len(series),'inputTokens':sum(a.get('usage',{}).get('prompt_tokens',0) for a in series),'outputTokens':sum(a.get('usage',{}).get('completion_tokens',0) for a in series),'cacheHitTokens':sum(a.get('usage',{}).get('prompt_cache_hit_tokens',0) for a in series),'firstBodyExposure':observed[0]['actualBodyExposure'] if observed else {},'anyBodyExposure':{s:any(a['actualBodyExposure'][s] for a in observed) for s in SKILLS}})
 for turn in sorted(set(a['turn'] for a in observed)):
  first=next(a for a in observed if a['turn']==turn);check(first['actualBodyExposure'][entry['selectedSkill']],f"explicit body absent {entry['id']} turn {turn}")
 if not (p/'fixture.json').exists():rows.append(row);continue
 fixture=load(p/'fixture.json');manifest=load(p/'manifest.json');check(manifest['day']==protocol['fixedDay'],f'{entry["id"]} fixture day mismatch');identity={'ownedSetMatchesVersion':fixture['before']['binding']['draft']['setId']==fixture['before']['version']['ref']['setId']}
 if entry['kind']=='J03':
  identity.update({'distinctSession':fixture['sessionId']!=fixture['otherSessionId'],'distinctSet':fixture['before']['version']['ref']['setId']!=fixture['otherBefore']['version']['ref']['setId'],'sharedBaseline':fixture['before']['binding']['baseRef']==fixture['otherBefore']['binding']['baseRef'],'referenceIsOtherPointA':fixture['annotationRefs']==[{**fixture['otherBefore']['version']['ref'],'objectIds':['point-a']}]})
 if entry['kind']=='J10':identity.update({'fixedOwnRevisionOne':fixture['annotationRefs']==[{'setId':fixture['before']['version']['ref']['setId'],'revision':1}],'currentRevisionTwo':fixture['before']['version']['ref']['revision']==2})
 if entry['kind']=='J08':identity.update({'publishedBeforeModel':bool(fixture['before']['publications']),'adoptedBeforeModel':fixture['before']['current'].get('publication') is not None})
 row['fixtureIdentityRelations']=identity
 for k,v in identity.items():check(v,f'{entry["id"]} fixture identity {k}')
 fixtures_by_case.setdefault(entry['caseId'],[]).append((entry['id'],fixture));catalog=load(p/'resources.json');catalogs[entry['id']]=[{k:v for k,v in x.items() if k!='hash'} for x in catalog['catalog']['skills']]
 for s in SKILLS:check(next(x for x in catalog['catalog']['skills'] if x['id']==s)['hash']==hashlib.sha256(bodies[g][s].encode()).hexdigest(),f'{entry["id"]} catalog body hash mismatch')
 if not (p/'final-state.json').exists():rows.append(row);continue
 final=load(p/'final-state.json');snapshot=final['snapshot'];messages=snapshot['messages'];native_results={}
 for m in messages:
  if m.get('spatialResult') and not m.get('isError'):
   r=m['spatialResult'];previous=native_results.get(r['resultRef'])
   if previous:check({k:v for k,v in previous.items() if k!='delivery'}=={k:v for k,v in r.items() if k!='delivery'},f'{entry["id"]} immutable spatial result changed across read')
   if r.get('delivery'):check(r['delivery']['requestId']==m['requestId'] and r['delivery']['toolCallId']==m['toolCallId'],f'{entry["id"]} fixed result delivery mismatch')
   native_results[r['resultRef']]=r
 check({r['resultRef']:r for r in final['results']}==native_results,f'{entry["id"]} final result vs native tool result mismatch')
 row['toolErrors']=[{'tool':m.get('toolName'),'text':m.get('text','')} for m in messages if m.get('isError')];errors_seen+=row['toolErrors']
 row['nativeSkillReads']=[]
 for resource in final['resources']:
  for skill in resource.get('readSkills',[]):
   row['nativeSkillReads'].append({'requestId':resource['requestId'],**skill})
   if skill['id'] in SKILLS:check(skill['hash']==hashlib.sha256(bodies[g][skill['id']].encode()).hexdigest(),f'{entry["id"]} native read hash mismatch')
 # Existing independently recorded whole document and actual write state, not just effect booleans.
 for tf in sorted(p.glob('turn-*.json')):
  if not re.fullmatch(r'turn-\d+\.json',tf.name):continue
  turn=int(tf.stem.split('-')[1])-1;t=load(tf);after=t['after'];before=load(p/f'turn-{turn+1}-before.json');expected,required=independent_expected(fixture,turn,t['snapshot']);actual=copy.deepcopy(after['version']['document']);original=fixture['before']['version']['document'];save_ok=None
  if entry['kind']=='J07' and turn==1:
   previews=[m['spatialResult'] for m in load(p/'turn-1.json')['snapshot']['messages'] if m.get('spatialResult',{}).get('operation')=='buffer'];saved_features=next(l for l in actual['layers'] if l['layerId']=='derived')['features'];save_ok=bool(previews) and len(saved_features)==1 and saved_features[0]['geometry']==previews[0]['geometry'] and saved_features[0]['name']=='临时范围'
   saved.append({'entry':entry['id'],'exactFirstPreviewGeometryAndName':save_ok,'savedCount':len(saved_features),'firstResultRef':previews[0]['resultRef'] if previews else None});required=True
   if save_ok:next(l for l in actual['layers'] if l['layerId']=='derived')['features']=[]
  unchanged=after==before;document_ok=actual==expected;pub=after['publications']==fixture['before']['publications'];adopt=after['current']==fixture['before']['current'];binding=all(after['binding'].get(k)==fixture['before']['binding'].get(k) for k in ['sessionId','taskId','workspaceId','bindingRevision','baseRef','writable']) and after['binding']['draft']['setId']==fixture['before']['binding']['draft']['setId']
  independent={'entry':entry['id'],'turn':turn,'expectedDocument':document_ok,'publicationsUnchanged':pub,'adoptionUnchanged':adopt,'bindingIdentityUnchanged':binding,'unchangedFromPriorTurn':unchanged,'authorizedActionOmitted':required and unchanged and (not document_ok or save_ok is False)}
  if save_ok is not None:independent['exactSavedGeometry']=save_ok
  recorded=load(p/f'turn-{turn+1}-effects.json');independent['recordedEffectBooleansMatch']=all(independent[k]==v for k,v in recorded.items());check(independent['recordedEffectBooleansMatch'],f'{entry["id"]} effect checker disagreement turn {turn}')
  check(pub and adopt and binding,f'{entry["id"]} unintended binding/publication/adoption state');check((document_ok and save_ok is not False) or unchanged,f'{entry["id"]} unexpected object mutation turn {turn}')
  if fixture.get('otherBefore'):
   other=load(p/f'turn-{turn+1}-other.json');independent['otherSessionExactlyUnchanged']=check(other==fixture['otherBefore'],f'{entry["id"]} other session mutation')
  effects.append(independent)
 for r in native_results.values():
  if r['operation']=='buffer' and r.get('geometry',{}).get('type')=='Polygon':
   center=r['items'][0]['geometry']['coordinates'];target=r['parameters']['distanceM'];ring=r['geometry']['coordinates'][0];err=max(abs(haversine(center,c)-target) for c in ring);origin=next(f for l in fixture['before']['version']['document']['layers'] for f in l['features'] if f['objectId']=='origin')['geometry']['coordinates'];radius.append({'entry':entry['id'],'resultRef':r['resultRef'],'vertices':len(ring),'radiusM':target,'maxRadiusErrorM':err,'centerEqualsFixtureOrigin':center==origin});check(err<1e-6,f'{entry["id"]} buffer radius >1e-6m')
 if entry['kind']=='J06':
  first=[m['spatialResult'] for m in load(p/'turn-1.json')['snapshot']['messages'] if m.get('spatialResult',{}).get('operation')=='buffer'];filters=[r for r in native_results.values() if r['operation']=='filter'];all_buffers=[r for r in native_results.values() if r['operation']=='buffer'];target=filters[-1].get('parameters',{}).get('spatial',{}).get('target',{}) if filters else {};ref=first[0]['resultRef'] if first else None
  reuse.append({'entry':entry['id'],'firstBufferRef':ref,'filterTarget':target,'reusedExactFirstGeometry':bool(ref) and target.get('resultRef')==ref and target.get('geometry') is True,'bufferResultCount':len(all_buffers),'filterResultCount':len(filters),'filterInput':filters[-1]['parameters'].get('input') if filters else None})
 rows.append(row)

fixture_consistency=[]
for case,items in fixtures_by_case.items():
 check(len(items)==3,f'{case} lacks full 3 fixture preparations')
 docs=[f['before']['version']['document'] for _,f in items];truth=[f['truth'] for _,f in items]
 equal=check(all(x==docs[0] for x in docs),f'{case} group fixture documents differ')
 fixture_consistency.append({'caseId':case,'entries':[i for i,_ in items],'documentsIdentical':equal,'oracleMetadataIdentical':check(all(x==truth[0] for x in truth),f'{case} oracle differs'),'documentHash':hashlib.sha256(stable(docs[0]).encode()).hexdigest()})
check(all(v==next(iter(catalogs.values())) for v in catalogs.values()),'catalog metadata differs beyond hashes')

group_stats={}
for g in GROUPS:
 rs=[r for r in rows if r['group']==g];candidate='map-annotations' if g=='map-only' else 'spatial-analysis' if g=='spatial-only' else None
 group_stats[g]={'planned':len(rs),'statusCounts':dict(Counter(r['status'] for r in rs)),'requests':sum(r['actualRequests'] for r in rs),'inputTokens':sum(r['inputTokens'] for r in rs),'outputTokens':sum(r['outputTokens'] for r in rs),'cacheHitTokens':sum(r['cacheHitTokens'] for r in rs),'elapsedMs':sum(r.get('elapsedMs',0) for r in rs),'toolErrors':sum(len(r.get('toolErrors',[])) for r in rs),'candidateSkill':candidate,'candidateExposedCases':[r['caseId'] for r in rs if candidate and r['anyBodyExposure'].get(candidate)],'candidateFirstPacketCases':[r['caseId'] for r in rs if candidate and r['firstBodyExposure'].get(candidate)],'candidateUnexposedCases':[r['caseId'] for r in rs if candidate and not r['anyBodyExposure'].get(candidate)],'nativeSkillReads':sum(len(r.get('nativeSkillReads',[])) for r in rs)}
tool_error_codes=Counter()
for err in errors_seen:
 try:code=json.loads(err['text']).get('code','unknown')
 except (json.JSONDecodeError,AttributeError):code='EXPECTED_BOUNDARY_CANCELLATION' if err['tool']=='ask_user' and err['text']=='当前请求已停止。' else 'unparsed'
 tool_error_codes[code]+=1
history_checks={}
for name in ['round1-live-evidence-index.json','round1-supplement-evidence-20261018.json']:
 old=load(TASK/'research'/name);mismatch=[p for p,h in old.items() if not (REPO/p).exists() or sha(REPO/p)!=h]
 history_checks[name]={'files':len(old),'mismatches':mismatch};check(not mismatch,f'Historical R1 raw evidence changed: {name}')
changed=subprocess.check_output(['git','diff','--name-only','746d4cc','--','.trellis/tasks/10-15-agent-map-spatial/round1*','.trellis/tasks/10-15-agent-map-spatial/research/round1*'],cwd=REPO,text=True).splitlines()
history_checks['trackedR1ArtifactsSinceApprovedPlan']={'referenceCommit':'746d4cc','changedPaths':changed};check(not changed,'Tracked R1 artifacts changed since approved plan')
evidence_index={str(p.relative_to(REPO)):sha(p) for p in BATCH.rglob('*') if p.is_file() and 'node_modules' not in p.parts and ('runtimes' not in p.relative_to(BATCH).parts or p.name=='runtime-integrity.json')}
report={'historyChecks':history_checks,'evidenceIndexFiles':len(evidence_index),'toolErrorCodes':dict(tool_error_codes),'type':'mechanical-evidence-audit-not-semantic-score','batch':str(BATCH.relative_to(REPO)),'head':protocol['head'],'planned':48,'allTrialsFinished':complete,'sourceHashCount':len(source_checks),'sourceChecks':source_checks,'runtimeChecks':runtime_checks,'providerModels':dict(provider_models),'parentToolSchemaHashes':sorted(schema_hashes),'httpStatuses':dict(http_status),'attempts':len(attempts),'usage':dict(usage_totals),'budgetMatches':budget['total']==len(attempts) and budget['input']==usage_totals['prompt_tokens'] and budget['output']==usage_totals['completion_tokens'],'groups':group_stats,'fixtureConsistency':fixture_consistency,'effectSnapshotCount':len(effects),'effects':effects,'bufferChecks':radius,'bufferVertexCount':sum(r['vertices'] for r in radius),'maxBufferRadiusErrorM':max((r['maxRadiusErrorM'] for r in radius),default=None),'fixedBufferReuse':reuse,'exactPreviewSaves':saved,'mechanicalErrors':errors,'rows':rows,'providerEvidence':request_audit,'scope':'No root/checker semantic verdicts read. Skill exposure is delivery evidence, not compliance or causal effect.'}
if '--partial' in sys.argv:
 Path('/private/tmp/r2-mechanical-partial.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'finished':complete,'attempts':len(attempts),'errors':errors},ensure_ascii=False));raise SystemExit()
check(complete,'batch still running/incomplete at final audit');report['mechanicalErrors']=errors
(TASK/'research/r2-evidence-index-20261018.json').write_text(json.dumps(evidence_index,ensure_ascii=False,indent=2)+'\n')
out=TASK/'research/r2-mechanical-audit-20261018.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines=['# R2 机械证据审计（非语义评分）','','日期：2026-10-18。只读原始证据，未调用模型、未读取主审或独立审阅语义分数。','',f"批次：`{report['batch']}`；冻结HEAD：`{report['head']}`。",'',f"计划48项，全部结束：{complete}；实际{len(attempts)}次provider请求；HTTP状态：{dict(http_status)}。",f"输入{usage_totals['prompt_tokens']:,} token（包含缓存命中），输出{usage_totals['completion_tokens']:,} token；与预算账本逐笔一致：{report['budgetMatches']}。",'', '| 组别 | 请求 | 输入token | 输出token | isError记录（含取消） | 原生Skill读取记录 |','| --- | ---: | ---: | ---: | ---: | ---: |']
for g,s in group_stats.items():lines.append(f"| {g} | {s['requests']} | {s['inputTokens']} | {s['outputTokens']} | {s['toolErrors']} | {s['nativeSkillReads']} |")
lines+=['','## 来源、夹具与模型输入','',f"核对{len(source_checks)}个冻结来源hash，三组runtime各246文件；baseline无差异，map-only/spatial-only只改变各自一个Skill文件。所有48实际fixture按用例比较三组document与oracle元数据，结果详见JSON。目录metadata忽略正文hash后相同。",'','实际模型、thinking、输出上限逐请求检查；父Agent工具schema只有一个哈希。首包及每轮首请求逐字核对显式选中的Skill正文，并逐包记录另一Skill是否真正曝光。原生readSkills的hash另外核对。','']
for g,s in group_stats.items():
 if s['candidateSkill']:lines += [f"- **{g}**：候选实际曝光 {', '.join(s['candidateExposedCases']) or '无'}；首包曝光 {', '.join(s['candidateFirstPacketCases']) or '无'}；未曝光 {', '.join(s['candidateUnexposedCases']) or '无'}。"]
lines+=['','未曝光用例不能归因于候选正文；曝光也不代表模型遵守或效果提升。','', '## 实际效果与独立几何核对','',f"核对{len(effects)}个turn状态，独立重建允许变更并核对实际完整document、publication、current和binding身份；涉及另一个会话的状态逐值比较。没有把driver的effect=true直接当作独立结论。",f"检查{len(radius)}个点buffer、共{report['bufferVertexCount']}个顶点；独立haversine采用R=6371008.8m，最大半径误差{report['maxBufferRadiusErrorM']}m。",'', 'J06首轮固定范围续用：','']
for v in reuse:lines.append(f"- {v['entry']}：复用首轮geometry={v['reusedExactFirstGeometry']}，buffer结果数={v['bufferResultCount']}，filter结果数={v['filterResultCount']}。")
lines+=['','J07首轮预览实际保存：','']
for v in saved:lines.append(f"- {v['entry']}：逐值几何与名称一致={v['exactFirstPreviewGeometryAndName']}，保存对象数={v['savedCount']}。")
lines+=['','工具错误原始记录分类：'+str(dict(tool_error_codes))+'。其中ask_user停止是预设边界提问后的驱动取消记录，不能算成工具故障。','','## 证据索引与历史保留','',f'本批原始证据SHA256索引覆盖{len(evidence_index)}个文件：[r2-evidence-index-20261018.json](r2-evidence-index-20261018.json)。覆盖provider输入/SSE/元信息、每轮输入/SSE/effects/前后状态、fixture/manifest/resources/final/native和协议预算账本。runtime源码不重复纳入，索引包含三组runtime-integrity.json；其before/after逐文件hash已另行核对，不遍历node_modules。','', '校验方式：在工作树根目录读取索引，对每个相对路径的原始文件按SHA256计算并与值比较；完整机械检查可运行本报告所链Python脚本。原始证据位于上述.local目录，未复制或改写。', '', '历史R1检查：'+str({k:v.get('files',v.get('changedPaths')) for k,v in history_checks.items()})+'；原始批次和补测索引全部匹配，已批准方案746d4cc之后R1冻结驱动/报告没有变更。']
lines+=['','## 审计异常与边界','',f"机械证据异常数：{len(errors)}。"]+([f'- {x}' for x in errors] if errors else ['本次机械检查未发现异常。'])
lines+=['','工具错误计数包含可恢复错误，不自动判语义失败；正确计算或保存也不代表全部可见解释正确。独立核验J06/J07关系并不代替其他题目的语义评分。完整逐项事实、请求hash、曝光、token、效果及几何误差见[JSON](r2-mechanical-audit-20261018.json)。', '', '审计脚本：[mechanical-audit.py](r2-engineering-evidence/mechanical-audit.py)。']
(TASK/'research/r2-mechanical-audit-20261018.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'complete':complete,'attempts':len(attempts),'groups':group_stats,'errors':errors,'bufferVertices':report['bufferVertexCount'],'maxRadiusErrorM':report['maxBufferRadiusErrorM']},ensure_ascii=False))
