# T01–T03 离线工具链复核

本记录只验证工具和真实调用链，不代表模型正确率。未调用真实模型，也未消耗付费模型额度。

| 检查 | 实际数据与独立预期 | 结果 |
| --- | --- | --- |
| T01 | D01 的 7 条来源记录仍保留；任务关系未确认，实际统计记录为 0，完整实体总量为 null，已知贡献为 0。查询、统计、固定结果读取不自校验中断。 | 通过 |
| T02 | D01 两个汇总覆盖的成员为 {e17,e26,e39} 与 {e26,e39,e48,e56}，另有 5 条单体及其中一条经受控导入的副本；8 条原始记录，合计应为 5 辆。 | 通过 |
| T03 | 同一 D01 数据中，第二个汇总改为缺少完整成员依据；完整去重合计必须为 null，不能以已知 5 冒充完整总量。 | 通过 |

每项经过本轮 `buildRuntime/startTrial`，建立独立任务、草稿及真实本地 HTTP 来源。模型端点由确定性 SSE 替代，只发出工具调用请求；业务工具返回由实际产品执行，未伪造。所有其他外部 URL 被拒绝，本地 HTTP 正常透传。

实际链路为：来源 HTTP 解码 → Pi 注册的 `task_resource_query query` → `summarize` → `read` 固定结果 → `spatial_analyze classify_points` → 保存并读取原生会话。每项 4 次真实工具调用、5 次本地确定性 provider 响应；固定读取的 records、summary 和引用与生成结果一致。

空间续用使用实际写入草稿的矩形。汇总没有实际位置，均保留为 `unclassified`，结果为 `partial`；没有补造成员位置。数据来源请求、受控导入回执、固定结果、工具事件、原生历史、确定性 provider 输入均保留在证据目录。`tool-regression-evidence.json` 保存结果摘要及证据 SHA-256。

验证：

- ESLint（两个新增检查文件）：通过。
- 本轮题包 TypeScript 检查：通过。
- `tool-regression.test.ts`：1 项测试通过，覆盖 T01/T02/T03；耗时约 146 秒。
- 运行前后本轮冻结产品及依赖完整性校验：通过。

第一次默认沙箱执行因本地监听 `EPERM` 未完成，原目录保留为 `/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/scope-tool-regression-uXtuwP`。随后以允许本地监听的权限执行，通过；这属于离线检查重试，未执行任何正式测评槽位。

通过的完整证据目录：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/scope-tool-regression-8uV99y`。
