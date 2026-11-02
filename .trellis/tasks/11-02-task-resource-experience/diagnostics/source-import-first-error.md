# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: annotations.spec.ts >> explicit source import uses the real controlled route and preserves source identity without publishing
- Location: tests/e2e/annotations.spec.ts:848:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '已保存到会话草稿', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: '已保存到会话草稿', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: '已保存到会话草稿', exact: true })

```

```yaml
- link "跳至相关信息":
  - /url: "#task-information-a"
- complementary "会话与资料":
  - img "Axon"
  - button "折叠侧边栏" [expanded]
  - button "新建对话"
  - button "工作待办"
  - button "态势地图" [pressed]
  - navigation "会话列表":
    - button "折叠工作任务" [expanded]: 工作任务
    - button "新建工作任务"
    - region "标注验证任务":
      - button "折叠项目：标注验证任务" [expanded]
      - button "进入项目：标注验证任务": 标注验证任务
      - button "在项目 标注验证任务 中新建对话"
      - button "新会话"
      - button "新会话"
    - button "折叠个人空间" [expanded]: 个人空间
    - button "新建个人空间"
  - button "设置"
- main:
  - text: 态势地图
  - region "地图标注工作区":
    - alert: 来源返回的数据不符合查询契约，无法作为完整资料使用。
    - status:
      - strong: 保存结果待确认
      - paragraph: 本地输入已保留。当前保存修订：1；编辑依据：见原操作。不会自动覆盖。
      - button "查询保存回执"
      - button "查看最新保存版本"
    - strong: 标注验证任务
    - text: 本会话草稿 · 可编辑 草稿 r1
    - button "标绘工具"
    - button "图层与对象"
    - button "版本与发布"
    - button "刷新标注"
    - region "态势地图":
      - region "Map"
      - button "Zoom in"
      - button "Zoom out"
      - button "Drag to rotate map, click to reset north"
      - group "底图视图":
        - button "影像" [pressed]
        - button "路网"
        - button "混合"
      - link "本地验证瓦片":
        - /url: https://www.openstreetmap.org/copyright
      - heading "海港救援船一号（来源对象）" [level=2]
      - button "关闭对象详情"
      - paragraph: 来源未提供状态
      - button "定位对象"
      - paragraph: 来源资料 · 只读 · 验证来源
      - button "引用到对话"
      - group:
        - text: 导入为会话标注
        - paragraph: 保存来源当前修订的位置及资源信息到草稿。来源提供了实体标识，保存时保留可靠关联。此操作不发布、不采用，也不修改来源。
        - paragraph: 船舶 · 实际资源 · 单个资源
        - text: 导入目标图层
        - combobox "导入目标图层" [disabled]:
          - option "集合点" [selected]
        - button "确认导入到草稿" [disabled]
      - group: 查看详情
```

# Test source

```ts
  756 |  const env=await setup(page);try{
  757 |   await layer(page);await point(page);const source=env.lab.annotations!.binding(env.actor,env.session.id).draft!;const old=env.lab.annotations!.privateVersion(env.actor,source.setId,2).document.layers[0]!.features[0]!;
  758 |   env.lab.annotations!.setBase(env.actor,env.second.id,{clientActionId:randomUUID(),expectedBindingRevision:0,baseRef:{setId:source.setId,revision:2}});
  759 |   await page.goto(`/situation?taskId=${env.task.id}&sessionId=${env.second.id}`);await expect(page.locator('.annotation-heading')).toBeVisible();await openTools(page);await pickOwn(page,'集合点 A point');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('旧基线修改');
  760 |   env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:2,operations:[{op:'update_object',objectId:old.objectId,changes:{name:'新的基线对象'}}]});
  761 |   const binding=env.lab.annotations!.binding(env.actor,env.second.id);env.lab.annotations!.setBase(env.actor,env.second.id,{clientActionId:randomUUID(),expectedBindingRevision:binding.bindingRevision,baseRef:{setId:source.setId,revision:3}});
  762 |   await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.getByText('草稿身份已变化，请保留或复制本地输入后取消旧编辑。')).toBeVisible();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('旧基线修改');await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeDisabled();expect(env.lab.annotations!.binding(env.actor,env.second.id).draft).toBeNull();
  763 |  }finally{await env.close();}
  764 | });
  765 | 
  766 | test('missing original receipt keeps the same pending action without resend or discarded input',async({page})=>{
  767 |  const env=await setup(page);try{
  768 |   await layer(page);await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill('未知保存结果');env.dropNextAction();await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.getByText('保存结果待确认',{exact:true})).toBeVisible();
  769 |   const pattern='**/api/annotation-actions/*';await page.route(pattern,route=>route.fulfill({json:null}));await page.getByRole('button',{name:'查询保存回执'}).click();await expect(page.getByText('尚未查询到回执；未自动重试，编辑内容仍保留。',{exact:true})).toBeVisible();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('未知保存结果');await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'取消编辑',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'放弃本地修改',exact:true})).toHaveCount(0);expect(env.requests.filter(item=>item.path.endsWith('/annotation/actions')&&item.body.action==='apply')).toHaveLength(1);
  770 |   await page.unroute(pattern);await page.getByRole('button',{name:'查询保存回执'}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);
  771 |  }finally{await env.close();}
  772 | });
  773 | 
  774 | test('late snapshot cannot replace a newer paired version while local input stays editable',async({page})=>{
  775 |  const env=await setup(page);let release=()=>{};
  776 |  try{
  777 |   await layer(page);await point(page);const binding=env.lab.annotations!.binding(env.actor,env.session.id);const setId=binding.draft!.setId;
  778 |   await pickOwn(page,'集合点 A point');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('保留乱序加载时输入');
  779 |   const rename=(revision:number,title:string)=>env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:revision,operations:[{op:'rename_set',title}]});rename(2,'第三版');
  780 |   let entered=()=>{};const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});const pattern=`**/api/annotations/${setId}/revisions/3`;
  781 |   await page.route(pattern,async route=>{entered();await gate;await route.fallback();});await page.getByRole('button',{name:'刷新标注',exact:true}).click();await started;await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeDisabled();await page.getByLabel('对象名称',{exact:true}).fill('加载中继续输入');
  782 |   rename(3,'第四版');await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');const response=page.waitForResponse(url=>url.url().includes(`/api/annotations/${setId}/revisions/3`));release();await response;await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('加载中继续输入');await page.getByRole('button',{name:'保存对象',exact:true}).click();await page.getByRole('button',{name:'合并我的修改并保存'}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r5');expect(env.lab.annotations!.privateVersion(env.actor,setId,5).title).toBe('第四版');
  783 |  }finally{release();await env.close();}
  784 | });
  785 | 
  786 | test('ordinary service validation keeps editable input and does not impersonate a version conflict',async({page})=>{
  787 |  const env=await setup(page);try{
  788 |   await layer(page);await point(page);await pickOwn(page,'集合点 A point');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await openProperties(page);await page.locator('.annotation-more-properties > details').filter({has:page.locator('summary',{hasText:'业务属性'})}).locator('summary').click();
  789 |   await page.getByLabel('业务属性 JSON').fill('{"__proto__":null}');await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.getByText('保存未完成',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'核对对象修改'})).toHaveCount(0);await expect(page.getByLabel('业务属性 JSON')).toHaveValue('{"__proto__":null}');expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);
  790 |   await page.getByLabel('业务属性 JSON').fill('{"contact":"李队"}');await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);const draft=env.lab.annotations!.binding(env.actor,env.session.id).draft!;expect(env.lab.annotations!.privateVersion(env.actor,draft.setId,3).document.layers[0]!.features[0]!.attributes).toEqual({contact:'李队'});
  791 |  }finally{await env.close();}
  792 | });
  793 | 
  794 | test('new local object merges into a newer saved revision exactly once',async({page})=>{
  795 |  const env=await setup(page);try{
  796 |   await layer(page);await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill('并发新增点');
  797 |   const binding=env.lab.annotations!.binding(env.actor,env.session.id);env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'rename_set',title:'Agent已更新标题'}]});
  798 |   await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.getByRole('region',{name:'核对对象修改'})).toBeVisible();await expect(page.locator('.annotation-conflict')).toHaveCount(0);expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);
  799 |   await page.getByRole('button',{name:'合并我的修改并保存',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);
  800 |   const saved=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,3).document;expect(saved.title).toBe('Agent已更新标题');expect(saved.layers[0]!.features).toHaveLength(1);expect(saved.layers[0]!.features[0]!.name).toBe('并发新增点');expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(3);expect(env.errors).toEqual([]);
  801 |  }finally{await env.close();}
  802 | });
  803 | 
  804 | test('changed object kind or deleted original layer stops the old form without rewriting saved objects',async({page})=>{
  805 |  const env=await setup(page);try{
  806 |   await layer(page);await point(page);const binding=env.lab.annotations!.binding(env.actor,env.session.id),setId=binding.draft!.setId;const old=env.lab.annotations!.privateVersion(env.actor,setId,2).document.layers[0]!;const object=old.features[0]!;
  807 |   await pickOwn(page,'集合点 A point');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('本地未保存名称');
  808 |   env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:2,operations:[{op:'update_object',objectId:object.objectId,changes:{kind:'line',geometry:{type:'LineString',coordinates:[[116.4,39.9],[116.41,39.91]]}}}]});
  809 |   await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.getByText('对象类型已变化，请取消旧编辑后重新打开。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeDisabled();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('本地未保存名称');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消编辑',exact:true}).click();
  810 |   await pickOwn(page,'集合点 A line');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('第二次本地输入');
  811 |   env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:3,operations:[{op:'add_layer',layer:{layerId:'surviving',name:'接收层',order:1,defaultVisible:true,features:[]}},{op:'update_object',objectId:object.objectId,changes:{},layerId:'surviving'},{op:'delete_layer',layerId:old.layerId}]});
  812 |   await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.getByText('原目标图层已删除，本地输入仍保留。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeDisabled();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('第二次本地输入');
  813 |   const saved=env.lab.annotations!.privateVersion(env.actor,setId,4).document;expect(saved.layers).toHaveLength(1);expect(saved.layers[0]!.layerId).toBe('surviving');expect(saved.layers[0]!.features[0]!.name).toBe('集合点 A');expect(saved.layers[0]!.features[0]!.kind).toBe('line');expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(4);expect(env.errors).toEqual([]);
  814 |  }finally{await env.close();}
  815 | });
  816 | 
  817 | test('resource form keeps unknowns and evidence, rejects multi-entity individual, and saves through real draft',async({page})=>{
  818 |  const env=await setup(page);try{
  819 |   await layer(page);await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill('港区救援资源');
  820 |   await page.getByText('资源信息 · 可选',{exact:true}).click();await page.getByRole('combobox',{name:'标注代表什么',exact:true}).selectOption('actual_resource');await page.getByRole('combobox',{name:'资源类别',exact:true}).selectOption('vessel');await page.getByRole('combobox',{name:'资源粒度',exact:true}).selectOption('individual');await page.getByLabel('填写数量',{exact:true}).check();await page.getByRole('combobox',{name:'单位',exact:true}).selectOption('艘');await page.getByLabel('数量范围',{exact:true}).fill('港区一队');
  821 |   await page.getByText('数量的依据、时间与条件',{exact:true}).click();await page.getByLabel('数量依据说明',{exact:true}).fill('值班员报告，等待核实');await page.getByLabel('报告时间',{exact:true}).fill('2026-11-02T10:00:00+08:00');await page.getByLabel('生效时间',{exact:true}).fill('2026-11-02T10:00:00+08:00');await page.getByLabel('失效时间',{exact:true}).fill('2026-11-03T10:00:00+08:00');await page.getByLabel('适用条件（每行一项）',{exact:true}).fill('天气允许\n现场确认');
  822 |   await page.getByLabel('数量（留空为未知）',{exact:true}).fill('2');await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form [role="alert"]')).toBeVisible();expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(1);
  823 |   await page.getByRole('combobox',{name:'与当前任务的关系',exact:true}).selectOption('potential_support');await page.getByText('任务关系的依据、时间与条件',{exact:true}).click();await page.getByLabel('任务关系依据说明',{exact:true}).fill('支援申请已确认');
  824 |   await page.getByRole('combobox',{name:'可用状态',exact:true}).selectOption('unknown');await page.getByText('可用状态的依据、时间与条件',{exact:true}).click();await page.getByLabel('可用状态依据说明',{exact:true}).fill('尚未得到可用确认');
  825 |   await page.getByRole('combobox',{name:'位置含义',exact:true}).selectOption('planned');await page.getByRole('combobox',{name:'位置代表',exact:true}).selectOption('site');await page.getByText('位置的依据、时间与条件',{exact:true}).click();await page.getByLabel('位置依据说明',{exact:true}).fill('计划集结站点');
  826 |   for(const title of ['任务关系','可用状态','位置']){const basis=page.locator('.annotation-resource-fields details').filter({has:page.getByText(`${title}的依据、时间与条件`,{exact:true})});await basis.getByLabel('报告时间',{exact:true}).fill('2026-11-02T10:00:00+08:00');await basis.getByLabel('生效时间',{exact:true}).fill('2026-11-02T10:00:00+08:00');await basis.getByLabel('失效时间',{exact:true}).fill('2026-11-03T10:00:00+08:00');await basis.getByLabel('适用条件（每行一项）',{exact:true}).fill('需现场确认');}
  827 |   await page.getByLabel('数量（留空为未知）',{exact:true}).fill('');await page.screenshot({path:test.info().outputPath('resource-form-1440.png')});await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);
  828 |   const ref=env.lab.annotations!.binding(env.actor,env.session.id).draft!;const saved=env.lab.annotations!.version(env.actor,env.task.id,{setId:ref.setId,revision:ref.headRevision}).document.layers[0].features[0];expect(saved.resource?.quantity).toMatchObject({value:null,unit:'艘',scope:'港区一队',conditions:['天气允许','现场确认'],reportedAt:'2026-11-02T10:00:00+08:00'});expect(saved.resourceAssociation).toBeUndefined();expect(saved.resource?.taskRelations?.[0]).toMatchObject({taskId:env.task.id,relation:'potential_support',conditions:['需现场确认']});expect(saved.resource?.availability?.state).toBe('unknown');expect(saved.resource?.position).toMatchObject({meaning:'planned',appliesTo:'site',reportedAt:'2026-11-02T10:00:00+08:00'});
  829 |   await pickOwn(page,'港区救援资源 point');await page.getByRole('button',{name:'编辑属性与坐标',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill('救援资源新名称');await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);
  830 |   const latest=env.lab.annotations!.binding(env.actor,env.session.id).draft!;expect(env.lab.annotations!.version(env.actor,env.task.id,{setId:latest.setId,revision:latest.headRevision}).document.layers[0].features[0].resource).toEqual(saved.resource);expect(env.errors).toEqual([]);
  831 |  }finally{await env.close();}
  832 | });
  833 | 
  834 | test('resource result card uses native fixed result, pages through authorized snapshot and clears revoked content',async({page})=>{
  835 |  let queried=false;let queryRef:import('../../src/contracts/annotations').AnnotationRef;const env=await setup(page,undefined,()=>queried?{text:'已查询固定结果。'}:(queried=true,{tools:[{name:'task_resource_query',arguments:{operation:'query',purpose:'data',annotations:[{ref:queryRef}]}}]}));try{
  836 |   const annotations=env.lab.annotations!;const receipt=annotations.action(env.actor,env.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'resources',name:'资源',order:0,defaultVisible:true,features:Array.from({length:12},(_,i)=>({objectId:`boat-${i}`,kind:'point' as const,name:`船舶候选 ${i+1}`,geometry:{type:'Point' as const,coordinates:[116+i*.001,39] as [number,number]},resource:{meaning:'actual_resource' as const,category:'vessel' as const,granularity:'individual' as const,quantity:{value:i===0?null:1,unit:'艘' as const,meaning:'entities' as const,scope:'港区',evidence:[{kind:'declaration' as const,note:'值班员报告'}],reportedAt:'2026-11-02T10:00:00Z',conditions:['待现场复核']}}}))}}]});
  837 |   // The deterministic runtime invokes the real query tool using an exact saved reference.
  838 |   queried=false;queryRef=receipt.ref!;
  839 |   // Query the actual saved draft through native Pi execution; UI never computes the summary.
  840 |   await env.lab.start(env.session.id,'查询资源',{},env.actor.seatId,undefined,env.actor.userId).run(()=>{});
  841 |   await page.goto(`/?session=${env.session.id}`);await page.getByText('处理过程 · 1 次工具调用',{exact:true}).click();const tool=page.locator('.tool-result').filter({has:page.locator('.resource-result-card')});await tool.locator(':scope > summary').click();
  842 |   const card=page.getByRole('region',{name:'资源查询结果'});await expect(card).toBeVisible();await expect(card).toContainText('未知');await expect(card).toContainText('12');await expect(card.getByText('船舶候选 1',{exact:true})).toBeVisible();
  843 |   await card.getByRole('button',{name:'下一页',exact:true}).click();await expect(card.getByText('船舶候选 11',{exact:true})).toBeVisible();await card.getByText('查看依据与限制',{exact:true}).first().click();await expect(card).toContainText('值班员报告');await expect(card).toContainText('待现场复核');await page.screenshot({path:test.info().outputPath('resource-card-1440.png')});
  844 |   const calls=env.fake.calls.length;await page.route(`**/api/sessions/${env.session.id}`,route=>route.fulfill({status:403,json:{error:{code:'FORBIDDEN',message:'此结果已不可访问'}}}));await card.getByRole('button',{name:'重新读取此结果'}).click();await expect(card).toContainText('此结果已不可访问');await expect(card.getByText('船舶候选 11',{exact:true})).toHaveCount(0);expect(env.fake.calls.length).toBe(calls);expect(env.errors).toEqual([]);
  845 |  }finally{await env.close();}
  846 | });
  847 | 
  848 | test('explicit source import uses the real controlled route and preserves source identity without publishing',async({page})=>{
  849 |  const env=await setup(page);try{
  850 |   const {ContextService}=await import('../../src/context/service');const ref={systemId:'source',objectType:'resource',objectId:'boat-1'};
  851 |   const item={ref,name:'海港救援船一号（来源对象）',revision:1,areaIds:[],effectiveAt:null,validTime:null,geometry:{type:'Point' as const,coordinates:[116.4,39.9] as [number,number]},properties:{},resourceData:{entityId:'boat-entity',resource:{meaning:'actual_resource' as const,category:'vessel' as const,granularity:'individual' as const}}};
  852 |   const data={systemId:'source',asOf:'2026-11-02T04:00:00Z',items:[item],limit:100,nextCursor:null,hasMore:false,timeUnknownCount:0,unknownRefs:[],changeCursor:'fixed'};
  853 |   env.lab.annotations!.context=new ContextService({systems:[{id:'source',name:'验证来源',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'TOKEN'}],scopes:[{id:'scope',name:'范围',systemIds:['source'],seatIds:['a']}]},{TOKEN:'synthetic'},{fetch:async()=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})});
  854 |   await page.route('**/api/context/catalog',route=>route.fulfill({json:{systems:[{id:'source',name:'验证来源',capabilities:['situation_current'],objectTypes:['resource'],areas:[]}]}}));await page.route('**/api/context/situation',route=>route.fulfill({json:{systemId:'source',query:route.request().postDataJSON(),queriedAt:'2026-11-02T04:00:01Z',data}}));
  855 |   await layer(page);await page.reload();await openLayers(page);await page.getByRole('button',{name:'展开来源态势',exact:true}).click();await page.getByText('筛选来源与范围',{exact:true}).click();await page.getByRole('button',{name:'查看全部获准态势',exact:true}).click();await page.getByRole('button',{name:'展开资源池',exact:true}).click();await page.getByRole('button',{name:new RegExp('海港救援船一号')}).first().click();
> 856 |   expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(1);await page.getByText('导入为会话标注',{exact:true}).click();await expect(page.getByText(/来源提供了实体标识/)).toBeVisible();await page.getByRole('button',{name:'确认导入到草稿',exact:true}).click();await expect(page.getByRole('button',{name:'已保存到会话草稿',exact:true})).toBeVisible();
      |                                                                                                                                                                                                                                                                                                                                                  ^ Error: expect(locator).toBeVisible() failed
  857 |   const draft=env.lab.annotations!.binding(env.actor,env.session.id).draft!;const feature=env.lab.annotations!.version(env.actor,env.task.id,{setId:draft.setId,revision:draft.headRevision}).document.layers[0].features[0];expect(feature.resourceAssociation).toEqual({source:ref,sourceRevision:1,entityId:'boat-entity'});expect(feature.resource).toEqual(item.resourceData.resource);expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(0);
  858 |   expect(env.requests.filter(r=>r.path.endsWith('/annotation/from-source'))).toHaveLength(1);expect(env.requests.find(r=>r.path.endsWith('/annotation/from-source'))!.body).not.toHaveProperty('resourceAssociation');await page.screenshot({path:test.info().outputPath('resource-controlled-import-1440.png')});expect(env.errors).toEqual([]);
  859 |  }finally{await env.close();}
  860 | });
  861 | 
  862 | test('map references remain explicit, removable and fixed; unsaved map editing permits ordinary chat',async({page})=>{
  863 |  const env=await setup(page);try{
  864 |   await layer(page);const name='港区救援船当前作业信息需要核对的较长对象名称'.repeat(5);await point(page,name);
  865 |   await page.goto(`/?session=${env.session.id}`);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await pickOwn(page,`${name} point`);
  866 |   const chips=page.getByLabel('本次引用的标注版本');await expect(chips.locator(':scope > span')).toHaveCount(0);await page.getByRole('button',{name:'引用此对象',exact:true}).click();await expect(chips).toContainText(name);await expect(chips).toContainText('r2');
  867 |   await chips.getByTitle('在地图核对固定标注引用').focus();await page.keyboard.press('Enter');await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('只读参考');await page.getByRole('button',{name:'引用此对象',exact:true}).click();await expect(chips.locator(':scope > span')).toHaveCount(1);
  868 |   await page.setViewportSize({width:1280,height:960});await expect(chips.getByTitle('在地图核对固定标注引用')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('resource-explicit-reference-1280.png')});
  869 |   await chips.getByRole('button',{name:'移除标注引用 1',exact:true}).focus();await page.keyboard.press('Enter');await expect(chips.locator(':scope > span')).toHaveCount(0);await pickOwn(page,`${name} point`);await expect(chips.locator(':scope > span')).toHaveCount(0);
  870 |   await page.getByRole('button',{name:'编辑属性与坐标',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill('尚未保存的新名称');await page.getByRole('button',{name:'关闭态势地图',exact:true}).click();await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('普通聊天，请确认收到');await page.getByRole('button',{name:'发送消息',exact:true}).click();await expect(page.getByText('已收到固定标注引用。',{exact:true})).toBeVisible();
  871 |   expect(env.requests.find(r=>r.path.endsWith('/messages'))?.body.annotationRefs).toBeUndefined();expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('尚未保存的新名称');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消编辑',exact:true}).click();
  872 |  }finally{await env.close();}
  873 | });
  874 | 
```