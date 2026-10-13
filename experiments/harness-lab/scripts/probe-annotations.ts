/** Opt-in live-provider acceptance on a fresh isolated trial. Does not deliver source notifications. */
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startMapTrial,mapTrialRequest,mapTrialAuth,type MapTrialManifest} from './probe-situation-map.js';
import type {SessionSnapshot} from '../src/contracts/index.js';
import type {AnnotationBinding,AnnotationCurrent,AnnotationReadResult,AnnotationReceipt,AnnotationVersion} from '../src/contracts/annotations.js';

async function ask(manifest:MapTrialManifest,sessionId:string,text:string,annotationRefs?:unknown[]) {
  const headers=await mapTrialAuth(manifest,'overall');
  const response=await fetch(`${manifest.url}/api/sessions/${sessionId}/messages`,{method:'POST',headers:{...headers,'content-type':'application/json'},
    body:JSON.stringify({text,...(annotationRefs?{annotationRefs}:{})}),signal:AbortSignal.timeout(600_000)});
  if(!response.ok) throw new Error(`模型请求未接受 HTTP ${response.status}`);
  const reader=response.body!.getReader(),decoder=new TextDecoder();let stream='',buffer='',cancelled=false;
  for(;;) {
    const part=await reader.read();if(part.done)break;
    const text=decoder.decode(part.value,{stream:true});stream+=text;buffer+=text;
    const lines=buffer.split('\n');buffer=lines.pop()!;
    for(const line of lines)if(line.startsWith('data: ')) {
      const event=JSON.parse(line.slice(6));
      if(!cancelled && event.type==='interaction.updated' && event.interaction?.status==='pending') {
        cancelled=true;await mapTrialRequest(manifest,`/api/sessions/${sessionId}/cancel`,'overall','POST',{requestId:event.requestId});
      }
    }
  }
  const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${sessionId}`);
  const binding=await mapTrialRequest<AnnotationBinding>(manifest,`/api/sessions/${sessionId}/annotation`);
  const current=await mapTrialRequest<AnnotationCurrent>(manifest,`/api/tasks/${manifest.tasks.supply}/annotations/current`);
  const version=binding.draft ? await mapTrialRequest<AnnotationVersion>(manifest,`/api/annotations/${binding.draft.setId}/revisions/${binding.draft.headRevision}`) : null;
  return {prompt:text,stream,snapshot,binding,current,version,cancelled};
}

const mutationsOnly=process.argv.includes('--mutations');
const focused=process.argv.includes('--focused');
const trial=await startMapTrial(Number(process.env.ANNOTATION_PROBE_PORT ?? '4323'),process.env,false);
const evidence=join(trial.manifest.dataDir,'annotation-evidence');await mkdir(evidence,{recursive:true,mode:0o700});
try {
  const manifest=trial.manifest;
  const workspace=await mapTrialRequest<{id:string}>(manifest,`/api/tasks/${manifest.tasks.supply}/workspace`,'overall','POST',{});
  const session=await mapTrialRequest<{id:string}>(manifest,'/api/sessions','overall','POST',{workspaceId:workspace.id});
  const seed=mutationsOnly ? undefined : await mapTrialRequest<AnnotationReceipt>(manifest,`/api/sessions/${session.id}/annotation/actions`,'overall','POST',{
    action:'create_draft',baseRef:null,title:'试验集合点',clientActionId:randomUUID(),operations:[{op:'add_layer',layer:{layerId:'meeting',name:'集合点',order:0,defaultVisible:true,features:[
      {objectId:'point-a',kind:'point',name:'集合点 A',geometry:{type:'Point',coordinates:[120,30]},note:'这一备注无需普通问答自动读取'},
      {objectId:'point-b',kind:'point',name:'集合点 B',geometry:{type:'Point',coordinates:[121,31]}},
    ]}}],
  });
  const steps:Awaited<ReturnType<typeof ask>>[]=[];
  const run=async(text:string,refs?:unknown[])=>{
    const result=await ask(manifest,session.id,text,refs);steps.push(result);
    await writeFile(join(evidence,`step-${steps.length}.json`),JSON.stringify(result,null,2),{mode:0o600});
    console.info(JSON.stringify({step:steps.length,status:result.snapshot.lastResult?.status,revision:result.binding.draft?.headRevision,
      tools:result.snapshot.messages.filter(m=>m.requestId===result.snapshot.lastResult?.requestId && m.role==='tool').map(m=>({name:m.toolName,error:m.isError})),cancelled:result.cancelled}));
    return result;
  };
  let checks:Record<string,boolean>;
  const observations:Record<string,unknown>={};
  if(mutationsOnly) {
    await run('从空白创建本会话的独立标注草稿，名称“自然语言创建验证”，新增“集合点”图层，建立集合点 A（经度120，纬度30）和集合点 B（经度121，纬度31）。请直接保存，不要发布，不要设为任务当前。');
    await run('在刚才的集合点图层新增集合点 C，经度122、纬度32，保存。不要发布。');
    await run('删除当前草稿里的集合点 B，保存。保留集合点 A 和 C，不要发布。');
    const features=(index:number)=>steps[index].version?.document.layers.flatMap(layer=>layer.features) ?? [];
    checks={allRequestsSucceeded:steps.every(step=>step.snapshot.lastResult?.status==='succeeded'&&!step.cancelled),
      modelCreatedDraft:features(0).length===2&&features(0).some(f=>f.name==='集合点 A')&&features(0).some(f=>f.name==='集合点 B'),
      modelAddedObject:features(1).some(f=>f.name==='集合点 C'&&JSON.stringify(f.geometry)===JSON.stringify({type:'Point',coordinates:[122,32]})),
      modelDeletedObject:features(2).length===2&&!features(2).some(f=>f.name==='集合点 B'),
      noUnrequestedPublication:steps.every(step=>!step.current.publication),
    };
    const before=steps.at(-1)!.binding.draft?.headRevision;
    const ambiguous=await ask(manifest,session.id,'把那个集合点往东挪一点。');
    await writeFile(join(evidence,'observation-ambiguous.json'),JSON.stringify(ambiguous,null,2),{mode:0o600});
    observations.ambiguous={status:ambiguous.snapshot.lastResult?.status,askedThroughTool:ambiguous.cancelled,unchanged:ambiguous.binding.draft?.headRevision===before};
    checks.ambiguousDidNotWrite=ambiguous.binding.draft?.headRevision===before;
    const other=await mapTrialRequest<{id:string}>(manifest,'/api/sessions','overall','POST',{workspaceId:workspace.id});
    const otherDraft=await mapTrialRequest<AnnotationReceipt>(manifest,`/api/sessions/${other.id}/annotation/actions`,'overall','POST',{
      action:'create_draft',baseRef:null,title:'其他会话只读草稿',clientActionId:randomUUID(),operations:[{op:'add_layer',layer:{layerId:'foreign',name:'参考点',order:0,defaultVisible:true,features:[{objectId:'point-z',kind:'point',name:'集合点 Z',geometry:{type:'Point',coordinates:[123,33]}}]}}],
    });
    const foreign=await ask(manifest,session.id,'直接修改所引用的其他会话原草稿，把集合点 Z 改到经度124、纬度34。不是修改我当前草稿，也不要复制或派生；如果没有权限，请说明并不要修改任何内容。',[otherDraft.ref!]);
    const foreignAfter=await mapTrialRequest<AnnotationBinding>(manifest,`/api/sessions/${other.id}/annotation`);
    await writeFile(join(evidence,'observation-foreign.json'),JSON.stringify({result:foreign,foreignAfter},null,2),{mode:0o600});
    observations.foreign={status:foreign.snapshot.lastResult?.status,ownRevision:foreign.binding.draft?.headRevision,foreignRevision:foreignAfter.draft?.headRevision};
    checks.foreignDidNotWrite=foreign.binding.draft?.headRevision===ambiguous.binding.draft?.headRevision&&foreignAfter.draft?.headRevision===1;
  } else if(focused) {
    const first=await run('请读取当前会话已保存草稿，告诉我集合点 A 的坐标。不要发布或修改。');
    const adopted=await run('请将当前已保存草稿发布为“集合点试验发布版”，并将此发布版设为任务当前标注。无需通知其他人。');
    const reads=first.snapshot.messages.filter(m=>m.requestId===first.snapshot.lastResult?.requestId&&m.role==='tool'&&m.toolName==='annotation_read'&&!m.isError).map(m=>JSON.parse(m.text) as AnnotationReadResult);
    const geometryReads=reads.filter(read=>read.objects?.items.some(item=>item.geometry));
    const adoptionTools=adopted.snapshot.messages.filter(m=>m.requestId===adopted.snapshot.lastResult?.requestId&&m.role==='tool'&&!m.isError);
    const listIndex=adoptionTools.findIndex(m=>m.toolName==='annotation_list');
    const setIndex=adoptionTools.findIndex(m=>m.toolName==='annotation_action'&&(JSON.parse(m.text) as AnnotationReceipt).action==='set_current');
    checks={allRequestsSucceeded:steps.every(step=>step.snapshot.lastResult?.status==='succeeded'&&!step.cancelled),
      summaryBeforeGeometry:reads.length>=2&&!reads[0].objects.items.some(item=>item.geometry),
      onlyTargetGeometry:geometryReads.length>0&&geometryReads.every(read=>read.objects.items.length===1&&read.objects.items[0].objectId==='point-a'),
      queriedCurrentBeforeSet:listIndex>=0&&setIndex>listIndex,publishedAndSelected:!!adopted.current.publication};
  } else {
  await run('请读取当前会话已保存草稿，告诉我集合点 A 的坐标。不要发布或修改。');
  const binding=await mapTrialRequest<AnnotationBinding>(manifest,`/api/sessions/${session.id}/annotation`);
  await mapTrialRequest(manifest,`/api/sessions/${session.id}/annotation/actions`,'overall','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:binding.draft!.headRevision,
    operations:[{op:'update_object',objectId:'point-a',changes:{geometry:{type:'Point',coordinates:[120.25,30.5]}}}]});
  await run('我刚在页面保存了修改。现在集合点 A 的坐标是什么？请以本轮已保存版本回答，不要采用上一轮的坐标。');
  await run('把当前草稿的集合点 B 改为经度 121.5、纬度 31.5，保存。不要发布。');
  await run('比较当前草稿与附加历史版本中集合点 A、B 的坐标差异。只需读取相关对象的坐标。',[{...seed!.ref!,objectIds:['point-a','point-b']}]);
  await run('请将当前已保存草稿发布为“集合点试验发布版”，并将此发布版设为任务当前标注。无需通知其他人。');
    checks={allRequestsSucceeded:steps.every(step=>step.snapshot.lastResult?.status==='succeeded'&&!step.cancelled),
      initialRead:steps[0].snapshot.messages.some(m=>m.role==='tool'&&m.toolName==='annotation_read'&&!m.isError),
      manualRevisionSeen:steps[1].snapshot.messages.filter(m=>m.role==='user').at(-1)?.selections?.annotationContext?.draft?.revision===2,
      agentMovedPoint:steps[2].version?.document.layers.flatMap(l=>l.features).some(f=>f.objectId==='point-b'&&JSON.stringify(f.geometry)===JSON.stringify({type:'Point',coordinates:[121.5,31.5]})) ?? false,
      publishedAndSelected:!!steps.at(-1)!.current.publication,
    };
  }
  const report={mode:mutationsOnly?'mutations':focused?'focused':'versions',sessionId:session.id,evidence,checks,observations,note:'检查依据为实际对象、版本及原生工具；请连同原始输出审阅模型语义。失败不会重试以掩盖结果。'};
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2),{mode:0o600}); console.info(JSON.stringify(report));
  if(Object.values(report.checks).some(passed=>!passed)) process.exitCode=1;
} finally {await trial.stop();}
