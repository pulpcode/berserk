# 第三批验收证据

2026-11-02。T01—26为验收主题，不是26道模型题。下表结合实际服务测试、浏览器操作及源码审核；不把确定性provider预设文字计为模型效果。真实模型调用0。

| 编号 | 实际证据与结论 |
|---|---|
| T01 来源引用 | `context-composer-map.test.ts`真实Context/Pi验证完整身份、发送时读取与历史原样重开；桌面situation-map object draft loads回归通过。名称读取不充当发送快照。 |
| T02 固定标注 | 桌面independent drafts、explicit saved reference；Pi annotations/composer原生历史，保存后引用固定版不随新head前进。 |
| T03 引用增删 | 新map references浏览器：单击不加、明确引用去重、键盘移除、再次选中不复活；既有composer选择机制未另建状态。 |
| T04 同名/重叠 | overlapping draft浏览器精确选只读组；chips显示图层/对象、版本，同层重名保留objectId，来源含objectType。 |
| T05 普通聊天 | 新map references：未保存编辑后普通聊天请求无annotationRefs，草稿修订不增加，本地编辑仍在；无单击/悬停/视图变化新增引用处理器。 |
| T06 未保存引用 | 旧object edit preserves回归验证未保存引用保护；固定引用仍固定，普通聊天不被锁定。 |
| T07 消费与恢复 | failed send新浏览器：前置失败还原原文本/r2引用；原references changed-selection等回归及现有consume/recover按owner保留新输入机制。未新增自动重发。 |
| T08 会话/权限 | 新failed send切换两会话，旧seat/workspace导航回归；Context/Pi资源权限测试覆盖缺失/撤权/跨席位、任务与会话。 |
| T09 资源基础 | resource form真实保存：个体数量2拒绝且不改修订、留空为null；旧普通点改名与缺省保留；task-resources验证0/未知契约。 |
| T10 每项事实 | resource form四类事实逐项填写依据、报告/生效/失效/条件；真实服务读回。普通改名保持全部resource及另一任务关系。 |
| T11 冲突保留 | annotation-edit-changes资源不同字段合并、同事实冲突、隐藏字段；旧object edit浏览器执行真实三方合并。 |
| T12 受控导入 | explicit source import真实HTTP/服务、后端生成实体关联、body不含伪造关联；task-resources/from-source覆盖无ID、复制、刷新、CAS、权限、取消与回执。 |
| T13 数量 | 真实资源卡显示null/已知部分/单位/含义；task-resource-query及summary契约覆盖混合单位/口径、潜在重复，前端无合计算法。 |
| T14 分页/三缺口 | 12项真实固定结果翻页；真实query→classify→summarize卡显示部分来源、部分关系、1项未知位置，统计按interior/assigned/available。 |
| T15 历史撤权 | Pi task-resource/results重启/压缩/read与撤权；浏览器从session重开固定卡，换页重检授权，403后清旧名单，无provider新增调用。 |
| T16 写入回执 | Pi annotation-workflow、annotation-source-history、annotations-acceptance；资源分析链不写草稿，显式导入只保存、不发布/采用，重发同action只读回执。 |
| T17 Skill交付 | map-skill、skill-discovery、skill-metadata、provider-payload：v2目录/正文/hash一致，真实SDK目录发现与read正文；旧composer不改。审核补回目录原能力。 |
| T18 方法规则 | skill-checks四类公开样例人工对照：任务资源、明确来源、纯图形、真实歧义。规则无冲突；这是方法审核而非自然语言模型测评。 |
| T19 资源对话 | pi/task-resource新增真实工具链：固定区域引用→skill_read→task query→分类→assigned/available/interior统计→read，检查名单/数量/未知位置/不写；浏览器独立实际链展示统计。 |
| T20 配置兼容 | model-thinking/models tests旧schema1—3未重写，4/5保存重启；旧缺省wire/普通保存不迁移；supported high/off、非法值、CAS、密钥保护。 |
| T21 实际请求 | configuredRuntime共享入口；真实SDK本地fetch捕获URL、model、thinking、effort、预算及工具续轮；新增所有三条设置HTTP路径检查、实际设置页面保存。 |
| T22 执行路径 | model-thinking实际首轮/续轮/readonly child/background/自动compaction及配置busy；共用compaction精确预算。没有手动压缩产品入口，不冒称该UI通过。 |
| T23 思考/中断 | 无thought文本正常完成、HTTP心跳不误停、真正idle/cancel；transport0重试，Pi原生503→成功两次同high请求。保留既有native最多3次额外重试。 |
| T24 历史格式 | composer-input、Pi annotations/spatial/task-resource原生旧v1—v5输入、空间v1/v2及资源派生，重启/压缩读取，不改旧正文/hash。 |
| T25 桌面 | 1440/1280三栏窄面板、长名2行及完整title、键盘核对/移除、表单/卡片/设置截图；隔离Chromium tabs.getZoom=1.25且dpr改变，真实原生缩放截图。 |
| T26 交接 | handoff.json记录基线/计划/实际代码数据Skill文件hash及协议版本；diagnostics保留原始失败和定向通过；无实现commit/push/deploy、无第四批模型调用。 |

最终：409项不同Vitest、15个不同浏览器用例通过。逐题原始名称/文件/最终结果见 `diagnostics/offline-test-index.json`；UI选取的具体回归名见 `ui-checks.md`。未声称穷举所有UI操作组合，也未把主题通过转换为模型准确率。
