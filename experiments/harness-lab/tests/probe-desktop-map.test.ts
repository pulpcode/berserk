import {describe,it,expect} from 'vitest';
import type {Interaction} from '../src/contracts/interactions';
import type {SessionSnapshot} from '../src/contracts/index';
import {comparisonOfPublications,desktopOptions,desktopCases,desktopRunCases,visibleRequestEvidence,clarificationChoice,seedLayers,recoveryStalled,validateOperatorAnswer,operatorQuestionAllowed} from '../scripts/probe-desktop-map';
const question=(prompt:string,options?:Array<{id:string;label:string}>):Interaction=>({kind:'question',schemaVersion:1,interactionId:'i',workspaceId:'w',sessionId:'s',requestId:'r',toolCallId:'t',toolName:'ask_user',createdAt:'2026-10-14T00:00:00Z',status:'pending',questions:[{id:'q',prompt,options}]});
describe('desktop acceptance driver boundaries',()=>{
 it('recognizes actual fixed-version comparison in new and legacy results, not errors or unknown wrappers',()=>{
  const data={left:{publicationId:'P1'},right:{publicationId:'P2'},counts:{note:1}};
  const msg={id:'t',role:'tool' as const,toolName:'annotation_read',text:JSON.stringify(data)};
  expect(comparisonOfPublications(msg,'P1','P2')).toBe(true);
  const projected={...msg,text:JSON.stringify({format:'annotation.model-result.v1',data})};
  expect(comparisonOfPublications(projected,'P2','P1')).toBe(true);
  expect(comparisonOfPublications(projected,'P1','P3')).toBe(false);
  for(const bad of [{...projected,isError:true},{...projected,resultMissing:true as const},{...projected,toolName:'annotation_action'},{...projected,text:'broken'},{...projected,text:JSON.stringify({format:'unknown',data})},{...projected,text:JSON.stringify({format:'annotation.model-result.v1',data:{...data,counts:undefined}})}])expect(comparisonOfPublications(bad,'P1','P2')).toBe(false);
 });
 it('adds exactly two independent collaboration environments without changing the default or allowing case selection',()=>{
  expect(desktopRunCases(desktopOptions([]))).toEqual(desktopCases);
  for(const args of [['--reporting-recheck'],['--reporting-recheck','--prepare-only']])expect(desktopRunCases(desktopOptions(args))).toEqual(['collaboration-1','collaboration-2']);
  expect(desktopOptions(['--reporting-recheck','--prepare-only']).prepareOnly).toBe(true);
  for(const args of [['--reporting-recheck','--prepare-only','--prepare-case','collaboration'],['--prepare-only','--prepare-case','main-1','--reporting-recheck'],['--reporting-recheck','--runs','3']])expect(()=>desktopOptions(args)).toThrow();
 });
 it('retains intermediate claims, final prose and resolved questions only for the actual request',()=>{
  const pending=question('确认前问题'),resolved={...pending,status:'answered',answers:[{questionId:'q',text:'按原目标'}]} as Interaction;
  const snapshot={messages:[{id:'old',requestId:'old',role:'assistant',text:'旧答复'},{id:'u',requestId:'r',role:'user',text:'原请求'},{id:'m',requestId:'r',role:'assistant',text:'确认前说明'},{id:'t',requestId:'r',role:'tool',text:'回执'},{id:'f',requestId:'r',role:'assistant',text:'最终说明'}],turns:[{requestId:'r',status:'succeeded',finalMessageId:'f'}],interactions:[resolved]} as SessionSnapshot;
  const result=visibleRequestEvidence(snapshot,'r',[pending]);
  expect(result.messages.map(m=>[m.text,m.position])).toEqual([['原请求','user'],['确认前说明','intermediate'],['最终说明','final']]);
  expect(result.interactions).toEqual([resolved]);expect(result.semanticReview).toBe('pending_review');
  expect(visibleRequestEvidence(snapshot,undefined,[pending]).messages).toEqual([]);
 });
 it('fixes three independent main chains and keeps preparation zero-model explicit',()=>{expect(desktopCases).toEqual(['main-1','ambiguity','collaboration','main-2','main-3']);expect(desktopOptions([])).toEqual({port:4361,prepareOnly:false});expect(desktopOptions(['--prepare-only','--port','4363'])).toEqual({port:4363,prepareOnly:true});for(const args of [['--retry'],['--approve-all'],['--runs','1'],['--port','80'],['--prepare-case','main-1']])expect(()=>desktopOptions(args)).toThrow();});
 it('only answers the exact predeclared clarification target, never permissions',()=>{expect(clarificationChoice(question('请选择集合点所在图层',[{id:'a',label:'现场讨论'},{id:'b',label:'保障讨论'}]))).toEqual({optionId:'a',label:'现场讨论'});expect(clarificationChoice(question('哪个集合点？'))).toEqual({text:'修改“现场讨论”图层里的集合点。'});expect(clarificationChoice(question('是否授权发布现场讨论图层？'))).toBeNull();expect(clarificationChoice(question('选择图层',[{id:'a',label:'现场讨论'},{id:'b',label:'现场讨论另一个'}]))).toBeNull();expect(clarificationChoice(question('需要什么帮助？'))).toBeNull();expect(clarificationChoice(question('哪个图层？',[{id:'a',label:'现场讨论并发布'}]))).toBeNull();const confirmation={...question(''),kind:'confirmation'} as Interaction;expect(clarificationChoice(confirmation)).toBeNull();});
 it('stops only unchanged consecutive failures in the same request',()=>{const calls=new Map([['a','x'],['b','x'],['c','x'],['d','y']]);const msg=(id:string,requestId='r',isError=true)=>({id,toolCallId:id,requestId,isError,role:'tool' as const,text:'error'});expect(recoveryStalled([msg('a'),msg('b'),msg('c')],calls,'r')).toBe(true);expect(recoveryStalled([msg('a'),msg('b'),msg('d')],calls,'r')).toBe(false);expect(recoveryStalled([msg('a'),msg('b','r',false),msg('c')],calls,'r')).toBe(false);expect(recoveryStalled([msg('a','old'),msg('b'),msg('c')],calls,'r')).toBe(false);});
 it('prepares genuine ambiguous identities without evaluation instructions',()=>{const layers=seedLayers(true);expect(layers.map(l=>l.name)).toEqual(['现场讨论','保障讨论']);expect(layers.flatMap(l=>l.features).map(f=>f.name)).toEqual(['集合点','集合点']);expect(new Set(layers.flatMap(l=>l.features).map(f=>f.objectId)).size).toBe(2);expect(seedLayers()[0].features.map(f=>f.name)).toEqual(['集合点甲','集合点乙']);});
 it('selects exactly the preset target even when the UI allows multiple choices',()=>{const item=question('要把哪个集合点的备注改为待核实？',[{id:'point-a',label:'现场讨论图层的 point-a'},{id:'point-b',label:'保障讨论图层的 point-b'},{id:'both',label:'两个都改'}]);if(item.kind==='question')item.questions[0].multiSelect=true;expect(clarificationChoice(item)).toEqual({optionId:'point-a',label:'现场讨论图层的 point-a'});});
 it('validates operator binding, exact question and option IDs without granting confirmation authority',()=>{
  const item=question('是否按原目标继续？',[{id:'yes',label:'按原业务目标继续'},{id:'no',label:'不执行'}]);
  const valid={operator:'acceptance-agent',interactionId:'i',requestId:'r',answers:[{questionId:'q',optionIds:['yes']}]};
  expect(validateOperatorAnswer(valid,item)).toEqual(valid.answers);
  expect(validateOperatorAnswer({...valid,answers:[{questionId:'q',text:'只按原来要求执行，不增加其他操作。'}]},item)).toEqual([{questionId:'q',text:'只按原来要求执行，不增加其他操作。'}]);
  for(const bad of [{...valid,operator:'human'},{...valid,interactionId:'wrong'},{...valid,requestId:'old'},{...valid,answers:[]},{...valid,answers:[{questionId:'unknown',optionIds:['yes']}]},{...valid,answers:[{questionId:'q',optionIds:['missing']}]},{...valid,answers:[{questionId:'q',optionIds:['yes','no']}]},{...valid,answers:[{questionId:'q',optionIds:['yes','yes']}]},{...valid,answers:[{questionId:'q',text:'',optionIds:['yes']}] }])expect(()=>validateOperatorAnswer(bad,item)).toThrow();
  expect(operatorQuestionAllowed({...item,status:'answered'} as Interaction)).toBe(false);
  expect(operatorQuestionAllowed(question('是否授予权限并执行命令？'))).toBe(false);
  expect(()=>validateOperatorAnswer(valid,{...item,kind:'confirmation'} as Interaction)).toThrow();
 });

});
