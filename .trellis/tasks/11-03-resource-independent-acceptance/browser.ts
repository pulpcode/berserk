/** P01 real desktop UI driver. No page request is fulfilled or replaced. */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import type {Page} from '../../../experiments/harness-lab/node_modules/@playwright/test/index.js';
const {chromium,expect}=createRequire(import.meta.url)('../../../experiments/harness-lab/node_modules/@playwright/test/index.js') as typeof import('../../../experiments/harness-lab/node_modules/@playwright/test/index.js');
import {acceptanceCase,type AcceptanceTurn,type CaseId} from './cases.js';
import {buildRuntime,startTrial,save,selection,type Trial} from './runtime.js';
import {profile} from './budget.js';
import {assertEquivalentAnnotationSelections} from './reference-check.js';

async function contents(page:Page){const button=page.getByRole('button',{name:'图层与对象',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();await expect(page.getByRole('complementary',{name:'图层与对象',exact:true})).toBeVisible();}
async function expand(page:Page,name:string){const toggle=page.getByRole('button',{name:'展开'+name,exact:true});if(await toggle.isVisible())await toggle.click();}
/** Caller must already have authorized provider execution. This function never configures one. */
export async function driveBrowserTurn(trial:Trial,turn:AcceptanceTurn,turnNumber:number,options:{headless?:boolean;timeoutMs?:number}={}){
 assert.ok(turn.annotationSelections?.length||turn.contextRefs?.length);
 const fixedLayers=trial.draftRef?trial.lab.annotations!.version(trial.lab.annotations!.actorForSeat('acceptance'),trial.taskId,trial.draftRef).document.layers:[];
 const directory=join(trial.directory,`browser-turn-${turnNumber}`);assert.ok(!existsSync(directory),'browser_evidence_overwrite_forbidden');mkdirSync(directory,{mode:0o700});
 const credentials=JSON.parse(readFileSync(join(trial.directory,'credentials.json'),'utf8')) as {username:string;password:string};
 const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:options.headless??true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
 const context=await browser.newContext({viewport:{width:1600,height:1000}});const page=await context.newPage();page.setDefaultTimeout(20000);
 const errors:string[]=[],messageBodies:unknown[]=[],sourceResponses:unknown[]=[];const pending:Promise<void>[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname===`/api/sessions/${trial.sessionId}/messages`&&request.method()==='POST'){messageBodies.push(request.postDataJSON());save(join(directory,'sent-message-bodies.json'),messageBodies);}});
 page.on('response',response=>{if(new URL(response.url()).pathname==='/api/context/situation')pending.push(response.json().then(body=>{sourceResponses.push(body);}).catch(()=>{}));});
 // Prevent background public tile traffic. Actual local UI, API and source requests are untouched.
 await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)||url.protocol==='data:'?route.continue():route.abort('blockedbyclient');});
 try{
  await page.goto(trial.url+'/');await page.getByLabel('席位',{exact:true}).selectOption('acceptance');await page.getByLabel('密码',{exact:true}).fill(credentials.password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'设置',exact:true})).toBeVisible();
  await page.goto(trial.url+'/?session='+trial.sessionId);await expect(page.getByRole('textbox',{name:'发送消息',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await contents(page);
  await expect(page.getByLabel('本次引用的地图对象').locator(':scope > span')).toHaveCount(0);await expect(page.getByLabel('本次引用的标注版本').locator(':scope > span')).toHaveCount(0);
  await page.screenshot({path:join(directory,'01-before-selection.png'),fullPage:true});
  const objectById=(objectId:string)=>{const layer=fixedLayers.find(l=>l.features.some(f=>f.objectId===objectId));assert.ok(layer);const feature=layer.features.find(f=>f.objectId===objectId)!;return {layer,feature};};
  const pickObject=async(objectId:string)=>{
   await contents(page);await expand(page,'本会话标注');const {layer,feature}=objectById(objectId);await expand(page,layer.name);
   await page.locator(`[data-layer-id="${layer.layerId}"]`).locator('.annotation-tree-objects > li > button').nth(layer.features.findIndex(f=>f.objectId===objectId)).click();
   await expect(page.getByRole('heading',{name:feature.name,exact:true})).toBeVisible();
  };
  if(trial.caseId==='P01'){
   await pickObject('p01-area');
   await expect(page.getByLabel('本次引用的地图对象').locator(':scope > span')).toHaveCount(0);await expect(page.getByLabel('本次引用的标注版本').locator(':scope > span')).toHaveCount(0);
   assert.equal(messageBodies.length,0);await page.screenshot({path:join(directory,'02-selected-no-implicit-reference.png'),fullPage:true});
   save(join(directory,'selection-before-reference.json'),{selectedName:'绀溪矩形',objectId:'p01-area',contextChipCount:0,annotationChipCount:0,messageRequestCount:0,observedAt:new Date().toISOString()});
  }
  for(const selector of turn.annotationSelections??[]){
   for(const layerId of selector.layerIds??[]){
    await contents(page);await expand(page,'本会话标注');const layer=fixedLayers.find(l=>l.layerId===layerId);assert.ok(layer);
    const row=page.locator(`[data-layer-id="${layerId}"]`);await row.getByRole('button',{name:'更多操作：'+layer.name,exact:true}).click();await row.getByRole('button',{name:'引用图层',exact:true}).click();
   }
   for(const objectId of selector.objectIds??[]){await pickObject(objectId);await page.getByRole('button',{name:'引用此对象',exact:true}).click();}
  }
  for(const sourceRef of turn.contextRefs??[]){
   await contents(page);await expand(page,'来源态势');const source=page.getByRole('region',{name:'来源态势',exact:true});
   const filters=source.locator('.source-query-controls');if(await filters.getAttribute('open')===null)await filters.locator('summary').click();
   const all=page.getByRole('button',{name:'查看全部获准态势',exact:true});if(await all.isVisible())await all.click();
   await expand(page,'资源池');const object=trial.fixture.objects.find(o=>JSON.stringify(o.ref)===JSON.stringify(sourceRef));assert.ok(object);
   await source.locator('.source-tree-objects button').filter({has:page.locator('strong').filter({hasText:object.name})}).click();
   await expect(page.getByRole('heading',{name:object.name,exact:true})).toBeVisible();await page.getByRole('button',{name:'引用到对话',exact:true}).click();
  }
  if(turn.annotationSelections?.length)await expect(page.getByLabel('本次引用的标注版本')).toBeVisible();await page.screenshot({path:join(directory,'03-explicit-references.png'),fullPage:true});
  const close=page.getByRole('button',{name:'关闭态势地图',exact:true});if(await close.isVisible())await close.click();
  const text=turn.text;await page.getByRole('textbox',{name:'发送消息',exact:true}).fill(text);
  const admitted=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/sessions/${trial.sessionId}/messages`&&response.request().method()==='POST',{timeout:options.timeoutMs??0});
  await page.getByRole('button',{name:'发送消息',exact:true}).click();const response=await admitted;assert.equal(response.status(),200);
  assert.equal(messageBodies.length,1);const body=messageBodies[0] as {text:string;contextRefs:unknown;annotationRefs:unknown};assert.equal(body.text,text);
  assert.deepEqual(body.contextRefs??[],turn.contextRefs??[]);assertEquivalentAnnotationSelections(body.annotationRefs,selection(trial,turn).annotationRefs);save(join(trial.directory,`turn-${turnNumber}-input.json`),body);
  await expect.poll(()=>{const snapshot=trial.lab.get(trial.sessionId,'acceptance');return Boolean(snapshot.lastResult&&!snapshot.active);},{timeout:options.timeoutMs??0,intervals:[250,500,1000]}).toBe(true);
if(turn.annotationSelections?.length)await expect(page.getByLabel('本条消息引用的标注版本')).toBeVisible();
  await page.screenshot({path:join(directory,'04-after-reply.png'),fullPage:true});await Promise.all(pending);save(join(directory,'source-ui-responses.json'),sourceResponses);
  save(join(directory,'message-response.json'),{status:response.status(),body:await response.text()});
  const snapshot=await trial.lab.readSavedSession(trial.sessionId,'acceptance');save(join(directory,'native-snapshot.json'),snapshot);
  const result={actualBrowser:true,apiMocked:false,sendCount:messageBodies.length,sessionId:trial.sessionId,taskId:trial.taskId,selectedWithoutReference:trial.caseId==='P01',explicitFixedReferences:body.annotationRefs,explicitSourceReferences:body.contextRefs,errors,screenshots:['01-before-selection.png',...(trial.caseId==='P01'?['02-selected-no-implicit-reference.png']:[]),'03-explicit-references.png','04-after-reply.png']};save(join(directory,'result.json'),result);assert.deepEqual(errors,[]);return result;
 }catch(error){await page.screenshot({path:join(directory,'failure.png'),fullPage:true}).catch(()=>{});save(join(directory,'failure.json'),{error:String(error),errors});throw error;}
 finally{await context.close();await browser.close();}
}
export const driveP01Browser=(trial:Trial,options:{headless?:boolean;timeoutMs?:number}={})=>driveBrowserTurn(trial,acceptanceCase('P01').turns[0],1,options);
/** Local deterministic wire response; this is protocol evidence, never a live-model score. */
export async function offlineBrowser(directory:string,port=4347,caseIds:CaseId[]=['P01','N02','N03']){
 assert.ok(!existsSync(directory),'offline_directory_exists');mkdirSync(directory,{recursive:true,mode:0o700});const runtime=await buildRuntime(directory,true);
 const original=globalThis.fetch;const calls:unknown[]=[];
 globalThis.fetch=async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);if(url.hostname==='127.0.0.1'||url.hostname==='localhost')return original(input,init);
  assert.equal(request.url,profile.baseUrl+'/chat/completions','external_request_blocked');const body=JSON.parse(await request.text());calls.push(body);save(join(directory,'deterministic-provider-inputs.json'),calls);
  const chunks=[{choices:[{index:0,delta:{role:'assistant',content:'离线浏览器验证：已收到所引用的图层和区域。'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:12,total_tokens:112}}];
  return new Response(chunks.map(chunk=>'data: '+JSON.stringify({id:'offline-browser',object:'chat.completion.chunk',created:1,model:profile.model,...chunk})+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 const results=[];let trial:Trial|undefined;try{
  for(const caseId of caseIds){trial=await startTrial(runtime,join(directory,caseId+'-offline'),caseId+'-offline',caseId,'offline-placeholder',port,true);const result=await driveBrowserTurn(trial,acceptanceCase(caseId).turns[0],1,{timeoutMs:60000});results.push(result);await trial.close();trial=undefined;}
  assert.equal(calls.length,caseIds.length);save(join(directory,'offline-browser-result.json'),{results,liveModelCalls:0,deterministicRequests:calls.length});return results;
 }finally{if(trial)await trial.close();globalThis.fetch=original;}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,directory,port,...caseIds]=process.argv.slice(2);assert.equal(command,'offline','Only offline mode is available from CLI');assert.ok(directory);void offlineBrowser(resolve(directory),Number(port??4347),caseIds.length?caseIds.map(id=>acceptanceCase(id as CaseId).id):undefined).then(result=>console.info(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
}
