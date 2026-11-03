# 实施与离线检查

2026-10-29。真实模型请求0。工作区是待验收的G2候选，不是已通过效果验收或已上线版本。

## 已完成

- 产品仅改两份Skill和annotation_action、symbolId、spatial_analyze使用说明。没有改参数形状、返回、服务、算法、UI和模型配置。Skill目录描述保持原样。
- `candidate-manifest.json`逐段登记13处修改；按decision、explanation重放可以精确生成G1、G2。四文件三组副本在candidates；G0与74986e0/ecff604一致，两提交的产品src/scripts/fixtures/包配置整体无diff。
- 8题逐字内容、初始草稿、固定回复与48槽顺序在task-list.md；6继承题保持原值，T04/T05标记新构造。三组交错，T01/T07首重复共6项后检查流程再继续42项。
- provider只允许三处已批准的说明差异，真实wire核对完整schema；Skill目录不变，正文按组精确交付；保留原生按需加载、每次请求证据、预算、实际模型检查与禁重试。

## 检查结果

|检查|结果|
|---|---|
|评测专用TypeScript|通过|
|评测文件根目录ESLint|通过|
|产品7个相关Vitest文件|73/73通过|
|48槽独立本地HTTP夹具|48/48，0模型请求，所有会话ID不同，继承数据/题干/回复一致|
|候选隔离和预算断言|通过：G0/G1/G2逐段重放、frontmatter不变、G1/G2工具相同、360请求及输出预留、429/未知用量拒绝下一请求|
|9槽受控原生HTTP/Pi链路|通过：48次假响应，0真实请求；三组真实skill_read正文进入模型wire，AskUser实际API，T07预览→原几何保存→同对象plan/note，T04真实港区4命中，T05circle无symbolId|
|首6流程与无进展|通过：第7项前确实触发门禁；假/过期/匿名批准被拒绝；同工具同证据连续三次停止，新用户轮重置|

离线测试并不证明模型正确率；受控T02终态故意不完成业务，用于确认模型答错仍可继续流程。

完整首次3项检查通过后，发现T04模拟调用的对象ID写成zone，且首次断言没有验证其筛选效果。这不涉及产品或正式题目；已把模拟ID修为真实harbor，补充无工具错误、真实4个命中名单断言，同时补首6拒绝和无进展检查。重新运行受影响的3项全部通过。48夹具准备未受该调整影响，不重复执行。前后日志都保留在offline/。

证据：

- 48夹具：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-improvement-lbFzLn/batch`
- 最终9槽原生链路：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-improvement-QQxWUq/batch`
- 首次9槽原记录：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-improvement-fM4meD/batch`

## 复现命令

在experiments/harness-lab执行：

```sh
node --import tsx --test ../../.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/run.test.ts
./node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/tsconfig.json
npm test -- tests/pi/map-skill.test.ts tests/pi/skill-discovery.test.ts tests/pi/annotations.test.ts tests/pi/spatial.test.ts tests/annotation-results.test.ts tests/annotation-edit-changes.test.ts tests/map-symbol-contracts.test.ts
```

根目录执行：

```sh
experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/*.ts
```

首次创建测试文件的工作目录填错、一次ESLint配置后缀填错，均在测试发起前失败；随后按正确路径执行。没有真实调用、模型重试或丢失原记录。
