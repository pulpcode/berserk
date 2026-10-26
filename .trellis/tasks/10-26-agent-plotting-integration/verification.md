# 整合实施验证记录

## 固定组合

- 产品输入：标绘 `99cba1f`，Agent `6a631a4`。
- 方案提交：`8da7fb1`；组合提交：`8c11de3`。详细指纹见 [baseline.json](baseline.json)。
- 独立工作树：`codex/agent-plotting-integration`。原 4324 试用服务、主线和另一工作树均未修改。
- 依赖：Node 24.14.0，`npm ci --offline --no-audit --no-fund` 成功。
- 5198 已有其他监听，工程浏览器验证改用空闲 5207。

## 最终工程检查

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| annotations / annotation-from-source / map-symbol-contracts / map-symbol-assets / map-symbol-rotation / annotation-results / annotation-map-evidence | 7 文件，101 项通过 | `/tmp/agent-plotting-service-tests.log` |
| Pi annotation-workflow / annotation-hook-boundaries / annotation-source-history / composer-input / spatial | 5 文件，76 项通过 | `/tmp/agent-plotting-pi-tests.log` |

上述检查使用独立测试数据和受控模型流，不消耗真实模型额度，也不能证明真实模型正确率。最终门禁结果见下文与 check.md。

## 最终门禁与修复记录

- 单元/Pi：216项通过（上述177项、Pi annotations 30项、annotation-edit-changes 9项）。
- 浏览器：最终全套43项通过，范围为 annotations、map-symbols、spatial。
- 全量 TypeScript、Lint（含模块边界检查）、生产构建通过。
- 首轮浏览器41项中39过、2失败：spatial旧测试仍假定工具常驻/画完自动保存，已按当前用户流程更新，不删除几何和分析证据断言。
- 独立复核另真实复现刷新会丢掉尚未完成的首顶点，修复为保留既有编辑runtime并临时暂停；同一复现用例修复后通过，随后全套43项通过。
- 已保存输入与冲突核对卡片、宽/窄/矮桌面截图保存在 verification/；主会话已目视核对冲突界面。
- 已完成已知CAS冲突卡片内核对时不重复显示顶部恢复横栏；未知回执仍保留原恢复入口。

完整独立复核见 [check.md](check.md)。首次失败/复现trace保留于本工作树 `.local/agent-plotting-check/`，没有覆盖成成功记录。

## 真实测评状态

P4 未发起真实模型调用，真实provider请求总计0。离线驱动完整9项通过后，补重复写入守卫并运行3项相关测试（其中2项新增），共11个唯一用例均有通过证据；作用域 TypeScript 与根目录 ESLint 通过。

30/30全新HTTP夹具prepare通过；受控native场景验证实际读写、CAS和重读保留字段。新增反例用两个不同动作ID重复保存同值，守卫能识别额外修订并停止后续槽位；失败CAS、原ID重放和回执读取不误算。C01/C10多写步骤仍须逐回执语义复核，不宣称自动守卫覆盖全部业务正确性。

详见 [驱动说明](evaluation/README.md)、[离线摘要](verification/evaluation-offline-summary.json) 和 [驱动测试日志](verification/evaluation-offline-tests.txt)。离线驱动准备与真实30槽成绩分开记录；未执行的真实槽位不得计为通过。真正live前须从最终提交重新冻结，并核对范围、额度及提供商当前计费条件。

## 需求与验证对应

| 需求 | 生产落点 | 验证 |
| --- | --- | --- |
| R1 单地图、符号及旋转保留 | 保留既有地图运行时和22项共享目录 | map-symbol-contracts/assets/rotation、map-symbols E2E、annotations 既有布局旋转回归 |
| R2 Agent 新字段/属性保留 | annotation-tools、map-annotations Skill | Pi annotations 真实工具/服务读写；annotation-edit-changes 检查只改指定字段、原始缺省、null和删除 |
| R3 来源、事实与业务数量 | 保留固定6a631a4说明并补信息性质/图标边界 | annotation-from-source、annotation-results、Pi source-history；真实自然语言质量仍待P4 |
| R4 人工与Agent接续 | useAnnotations、FeatureEditor、AnnotationWorkspace、EditComparison | annotations E2E覆盖不同字段、同字段选择/同值、二次冲突、引用保护、乱序/失败刷新、身份变化、删除/只读、原回执回查 |
| R5 分析保存与解释 | 复用既有Pi空间分析与证据链 | Pi spatial、spatial E2E、annotation-map-evidence；真实回答事实性仍待P4 |

## 工程变更边界

- 仍使用原API、数据库和顶层合并语义；没有增加Agent工具种类、服务器锁或跨标签同步机制。
- 只有显式确认才合并保存；同字段不同值不默认选边。未知结果沿原动作ID查回执，不自动重发。
- 未保存输入在浏览器组件内；刷新不替换表单、不把未保存预览传给Agent。
- 工程测试与后续真实30槽位测评分开；合成provider不计模型准确率。

## 提交与证据整理

产品实现提交：`4431d4de44332776ef437a5d49d4b4016f78df9f`（中文标题）。后续记录提交只整理任务状态与验证证据。仓库内文本日志副本去除行末空白并合并完全相同的重复文件；原始日志与失败trace仍保留在上述临时路径及本工作树.local目录。
