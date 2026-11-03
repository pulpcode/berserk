# N07评测器修复与恢复准备

仅修评测器。产品、Skill、问题、数据、评分和单问接续规则不变；不替N06补回答或重跑。

## 引用核对

browser.ts仍通过真实UI点击并发送原始POST。新reference-check只比较固定版本、选择类型和对象集合，允许同一集合拆为多份附件或换序。缺对象、多对象、不同set/revision、publication与固定版本混淆、整版本引用扩大、图层/对象混淆均拒绝。混合图层+对象过滤保持原子，避免错误分配组合。

15条正反例通过。真实N07桌面确定性运行通过：两份单对象附件原样发送1次，实际UI/API未mock，只有提供方被本地固定响应替代，0真实模型调用。证据在 `/private/tmp/resource-acceptance-resume-n07-20261103`，含截图、POST、原生历史及hash；不是新的模型正确率。

## 恢复准备

新resume.ts只适用于已记录的这次N07中断，pin旧protocol、ledger、public gate、N07审计和全部原始失败证据hash；同时验证旧冻结材料归档及原产品。旧批只读。只允许browser.ts已审阅的两处替换；原有其他冻结文件不能改变。

新目录重新prepare冻结修复后的评测器，产品仍333cb51、模型/profile/limits/schedule及完整安装依赖相同。复制前10槽证据并逐字节hash核对，复用原公开流程门槛；不把旧N07失败目录写进新槽。继承全部48条提供方attempt和输入1,624,623/输出35,216，不重置预算。原停止原因留在旧批；新批manifest记录授权、来源hash、旧新freezeHash、复用及剩余槽和证据hash。

恢复脚本拒绝未知用量、未结算请求、错误停止原因、N07已有提供方尝试、原件漂移、新目录已存在、原产品/依赖漂移。10条离线检查通过，包括新账本下一请求从49开始。保留旧账本与N07失败，禁止把恢复计作无失败历史。

## 启动方法（实施席未执行）

从仓库根目录运行：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-03-resource-independent-acceptance/resume.ts .local/resource-independent-acceptance/20261103-live-01 .local/resource-independent-acceptance/20261103-live-02
```

该步骤不会调用模型，也不会生成readiness.json；主会话须完成本轮独立检查并为新冻结版本写新的readiness，再用既有run.ts执行N07-1、N08-1、N08-2至N01-2。不重跑前10槽，不覆盖旧记录。

任务tsc、显式使用experiments/harness-lab/eslint.config.js的五文件ESLint通过。初次ESLint遗漏配置查找失败已纠正；不计作一次通过。检查元数据见resume-validation.json。
