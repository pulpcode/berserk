# 后处理验证与公开包生成记录

本次只读后处理未调用模型，未修改产品或冻结执行文件。由两份独立Agent审阅和主审明确裁决驱动；程序校验不代替语义审阅。

- `compile-reviews.test.ts` 7项、`report-materials.test.ts` 6项，共13项通过。
- 全任务 `tsc --noEmit -p .trellis/tasks/11-02-task-resource-acceptance/tsconfig.json` 通过。
- 四个后处理TS文件定向ESLint通过。
- 最后核对protocol.files全部冻结hash，漂移0。
- 20个公开轨迹JSON均已导出；未复制ReviewPacket待审模板、provider请求/原生响应、native历史、凭据或私有思考。公开包敏感字段/禁止原件模式检查为0。

测试从 `experiments/harness-lab` 运行：

```sh
node --import tsx --test ../../.trellis/tasks/11-02-task-resource-acceptance/compile-reviews.test.ts ../../.trellis/tasks/11-02-task-resource-acceptance/report-materials.test.ts
```

完整公开材料先在新目录生成：

```sh
node --import tsx ../../.trellis/tasks/11-02-task-resource-acceptance/report-materials.ts ../../.local/task-resource-acceptance/batch-20261102-01 ../../.local/task-resource-acceptance/final-public-v2
```

每项编译均使用 `compile-reviews.ts BATCH RECORDS ENTRY NEW_OUTPUT` 新路径，原始双审保持；主审决议绑定原件hash。A04-2另存初版主审决议并公开记录关键约束裁决纠正。A06-2另存产品故障分类修订，冻结score与解释N/A报告投影分别保留。

本目录由会话内离线脚本汇集20个public.json，未复制待审模板；使用冻结`aggregateFormal`汇总16个已reviewed score，解释N/A从有答复解释率中单列。仅移除机器绝对根路径前缀，原件路径和hash仍可回溯。初始system/user上下文正文留在private，公开索引仅有路径/hash/字段路径。

机器汇总：主任务15/16；严格9/16；有答复解释9/15；关键约束授权/身份/覆盖各16/16，分配可用状态15/16；重复1主8/8严格5/8，重复2主7/8严格4/8；双次主成功7/8，双次严格成功3/8。正式评分全部完成，但A06-2业务执行incomplete/product failure单列保留。

全批实际请求90，输入2,900,996，输出57,986，未知用量0。Skill工具成功读取11次，正式8次/6题、公开3次/2题；读取率不作为正确率或因果效果。
