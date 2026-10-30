/** Read-only UI check of the exact live saved object; no model turns or writes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {mapState} from '../../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {MapTrialManifest} from '../../../../../experiments/harness-lab/scripts/probe-situation-map.js';
const require=createRequire(resolve('package.json'));
const {chromium,expect}=require('@playwright/test') as typeof import('../../../../../experiments/harness-lab/node_modules/@playwright/test/index.js');
const [entryDir,outPrefix]=process.argv.slice(2);assert.ok(entryDir&&outPrefix);
const read=(name:string)=>JSON.parse(readFileSync(join(entryDir,name),'utf8'));
const manifest=read('manifest.json') as MapTrialManifest,review=read('review.json'),sessionId=review.sessionId;
const before=await mapState(manifest,sessionId);
const layer=before.version!.document.layers.find(l=>l.layerId==='derived');
const target=layer?.features.find(f=>f.name==='临时范围');assert.ok(target,'saved target missing');
const previews=review.snapshot.messages.filter((m:{spatialResult?:{operation?:string}})=>m.spatialResult?.operation==='buffer');assert.equal(previews.length,1);assert.deepEqual(target.geometry,previews[0].spatialResult.geometry,'saved geometry differs from original preview');
const account=JSON.parse(readFileSync(join(manifest.dataDir,'credentials.json'),'utf8')).accounts.planning;
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});
const writes:Array<{method:string;path:string}>=[];const errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
 if(!['GET','HEAD'].includes(req.method())){
  writes.push({method:req.method(),path});
  if(path.endsWith('/messages')||path.includes('/annotation/actions')||path.endsWith('/annotations/current'))return route.abort('blockedbyclient');
 }
 return route.continue();
});
try{
 await page.goto(manifest.url);await page.getByLabel('席位',{exact:true}).selectOption('seat-planning');await page.getByLabel('密码',{exact:true}).fill(account.password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await expect(page.getByRole('button',{name:/^进入项目：.*空间资料核对任务$/}).first()).toBeVisible();
 await page.goto(`${manifest.url}/situation?taskId=${manifest.tasks.supply}&sessionId=${sessionId}`);
 await expect(page.locator('.annotation-heading')).toBeVisible();
 if(!await page.locator('.annotation-sidebar').isVisible())await page.getByRole('button',{name:'图层与对象',exact:true}).click();
 const expand=page.getByRole('button',{name:'展开本会话标注',exact:true});if(await expand.isVisible())await expand.click();
 const own=page.getByRole('region',{name:/^本会话标注 /});const toggle=own.getByRole('button',{name:/^(展开|收起)派生层$/});if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 await own.getByRole('button',{name:'临时范围 polygon',exact:true}).click();
 const detail=page.getByRole('region',{name:'标注对象操作'});await expect(detail).toContainText('本会话可编辑');const detailText=await detail.innerText();
 await detail.getByRole('button',{name:'编辑属性与坐标',exact:true}).click();
 const form=page.getByRole('form',{name:'标注对象编辑'});await expect(form).toBeVisible();
 const more=form.locator('.annotation-more-properties');if(await more.getAttribute('open')===null)await more.locator(':scope > summary').click();
 const controls=await form.locator('input,select,textarea').evaluateAll(elements=>elements.map(e=>({tag:e.tagName,label:e.closest('label')?.textContent,value:(e as HTMLInputElement).value})));writeFileSync(outPrefix+'-controls.json',JSON.stringify(controls,null,2)+'\n',{flag:'wx'});
 const name=await form.getByLabel('对象名称',{exact:true}).inputValue(),role=await form.getByLabel('信息性质').inputValue(),note=await form.locator('label').filter({hasText:/^备注/}).locator('textarea').inputValue(),saveEnabled=await form.getByRole('button',{name:'保存对象',exact:true}).isEnabled();
 assert.equal(name,target.name);assert.equal(role,target.informationRole??'');assert.equal(note,target.note??'');assert.ok(saveEnabled);
 await page.screenshot({path:outPrefix+'.png',fullPage:true});
 const after=await mapState(manifest,sessionId);assert.deepEqual(after,before,'browser verification changed actual state');
 assert.ok(!writes.some(r=>r.path.endsWith('/messages')||r.path.includes('/annotation/actions')||r.path.endsWith('/annotations/current')),'unexpected write attempt');
 writeFileSync(outPrefix+'.json',JSON.stringify({id:review.entry.id,sessionId,objectId:target.objectId,layerId:'derived',ref:before.version!.ref,detailText,name,role,note,saveEnabled,mutations:writes,pageErrors:errors,stateUnchanged:true},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({id:review.entry.id,browserChecked:true,objectId:target.objectId,name,role,note}));
}catch(e){await page.screenshot({path:outPrefix+'-failure.png',fullPage:true}).catch(()=>{});writeFileSync(outPrefix+'-failure.json',JSON.stringify({error:String(e),url:page.url(),body:(await page.locator('body').innerText()).slice(0,20000),mutations:writes},null,2)+'\n',{flag:'wx'});throw e;}
finally{await browser.close();}
