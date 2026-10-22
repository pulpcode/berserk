# R5主动读取入口与八项驱动实施记录

本记录只说明已实现的入口、隔离方式及离线检查，不是模型效果报告。实施依据为已提交方案`b141f39`第9节；真实8项由主会话在全部检查后执行。后续12项不在当前执行范围，本文没有记录真实模型成绩。

## 产品改动

`src/pi/resource-tools.ts`保持原skill_read工具名称、正文读取、权限、快照、历史记录与执行路径，只将id从任意字符串改成当前请求snapshot.skills生成的Type.Union/Type.Literal候选。每个候选说明使用同一条记录的name与description，不复制Skill正文，不另维护用途文案。空Skill快照不注册读取工具。既有子Agent白名单不变，已有正文不要求重复读取。

`tests/pi/skill-discovery.test.ts`直接验证受限单候选、空目录省略、schema不带正文，以及绕过schema直接执行非法ID仍被服务端snapshotSkill拒绝、不会保存成功历史。`tests/pi/provider-payload.test.ts`最后一个空间目录测试验证真实provider JSON中四个候选的ID、名称、简介完整保留，正文仍只在真实读取后进入模型输入。现有map-skill测试继续覆盖历史重开、按需/显式读取和子Agent工具限制。

准备中单候选断言曾误认为Type.Union会压平为单个const；实测保留anyOf[单项]，仅修正断言，未改产品行为。最初一次导入测试遇到其他worker尚未写完的skill-method-advice.ts；待并行改动落齐后再测，没有真实模型调用。

## 只改变一个因素的运行时

新目录`r5-20261022/`独立于冻结的R3/R4。`runtime.ts`从`b56de822cec4ee2519ac8a24eb307a6230cac29d`的git archive完整提取src/scripts/fixtures及包配置，复用相同锁文件对应依赖：

- L0（内部A）：原样R4-B产品。
- L1（内部B）：只覆盖新resource-tools.ts；程序逐字确认它相对基线只改变候选schema和空目录分支。
- 运行时哈希确认其它文件、Skill原正文、简介、宿主约定都来自同一基线。并行实现的objectNames、classify_points、错误提示与新Skill正文不会进入这8项。
- `live-provider.ts`复用冻结R3 provider记录器，只补两组schema校验。每次原生请求实际送出的L1候选须等于本请求目录；除skill_read.id外，全部工具定义逐字一致。校验失败在发送外部请求前停止。
- 原始请求/SSE、使用量、资源、交互、原生会话和before/after均保留。已开始条目不自动重试，resume仅跳过它们；全局source/runtime漂移拒绝继续。

## 固定题单与计分

固定D02/D05/D16/N01各L0/L1一轮，共8项，全为自动读取。资源点改名为海岬/白沙/南堤支援点，保持ID、坐标和独立真值；这仍是公开开发题变体，不是新保留集。

方法期望与评分已在`review-rubric.md`及protocol中预先冻结：D02空间/标绘之一可满足；D05只需空间方法；D16分别检查首次范围生成前的空间方法、保存决定前的标绘方法；N01不应调用工具。主要及时覆盖分母3题（D16两阶段均覆盖才算），辅助阶段分母4，不再把每个读取标绘的题都判成必须读两份Skill。任务正确性独立计分，发生错误后才读不能倒算首次及时读取。

普通澄清与API契约由主会话另写离线判例；本批没有必要澄清分支，不给失败模型追加隐藏回答。旧评分保持不变。`summarize.mjs`校验8份review.json的哈希，调用冻结R3语义score/summarize，报告标签为L0/L1；加载时间仍需根据实际provider输入单独复核。

预算维持题间120请求/200万输入token/4万输出token，开始下一题前预留24请求/30万输入/1万输出。24请求、64工具、10分钟仅提示，不中断仍正常推进的当前任务。没有自动追加12项、第二轮、失败重试或付费裁判。

## 离线检查

- 新入口及map-skill/provider-payload：11项通过（单候选断言修正后最终复核）；实际payload候选保留与原正文按需加载已确认。
- `smoke.test.ts`：3项通过。8个完整HTTP/Pi假模型任务全部recorded，共16次模拟provider请求；A/B除读取候选外的schema相同；没有objectNames/classify_points；resume没有新增请求。另用7次模拟请求完成D16真实CAS冲突恢复，保存原预览且保留外部备注。
- `provider.test.ts`：2项通过。候选说明或其它工具schema漂移均在新增外部请求前拒绝。
- `critical-effects.test.ts`由检查Agent补5项，覆盖原标题、图层属性/顺序、保存目标和对象名称保护；主会话统一收集其最终类型及lint结果。
- 任务内TypeScript及仓库根ESLint通过；产品完整工程回归由主会话汇总。
- `git diff --check`通过；冻结R3/R4目录没有改动。

以上测试均使用假模型或确定性输入，不表示主动读取率提高。真实8项是否出现效果须等待完整原始记录逐项复核；正式90%门槛未由本批离线检查取得。
