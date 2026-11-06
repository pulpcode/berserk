# v4 场景初始化与兼容验证

2026-11-06；确定性本机 HTTP、SQLite 与原生 Pi 替身测试，不调用真实模型或外部服务，不部署。

- 场景为 `harbor-fire` / `4`，定义 hash 为 `12650b4decef4b341560e0f4b34a92f44e0edbb0836ad7f457c4633f7120ceca`。保留 24 车、53 对象、41 资源、12 步和 13 通知。
- 新来源快照和宿主映射均使用 `schemaVersion:2`，保存 `taskBootstrap:{schemaVersion:2,definitionId,definitionVersion,definitionHash,expectedTaskCodes:['T02','T03']}`。定义 hash 对世界内容计算，未把描述符循环加入 hash。
- 来源 detail、tasks、provenance 和宿主初始化 DTO 传递同一描述符；启动、初始化重试与激活核对完整定义。旧 schemaVersion1 仍严格要求 T01/T02/T03，保持旧映射、原始通知、来源 hash 与回执可读，不改写为两个任务。
- 缺失/未知版本、空/残缺/重复任务、校验 hash 不一致均拒绝。任务已提交但映射未确认的重启从原始 task_actions 回执恢复，保存原 taskId/clientActionId 后继续剩余任务。
- 新来源不包含 T01 模板或导演任务标注；两个背景目标只保留业务时间、占用和引用。归档枚举本轮全部实际绑定的 task_spaces，沿用未完成工作及后台预留检查。

验证：

- `npm run typecheck` 通过。
- 对本次来源、contracts、scope、宿主和测试文件执行 ESLint 通过；`git diff --check` 通过。
- 三个定向测试文件共 35 项：mock-scenarios 19、scenario-director-api 11、scenario-run-isolation-integration 5。首次正常权限运行 34 项通过；原有定义变化测试仅修改 instance hash 而不修改新描述符，现改为两者一致的旧定义故障注入，单项复验通过。
- 默认沙箱试跑被本机监听 `EPERM` 阻断；正常权限的确定性复验通过。使用 `--configLoader runner` 避免共享 node_modules 的配置临时文件写入。

总体完整测试、桌面浏览器验证和真实模型语义测评由主会话分段执行；本文件不据确定性执行成功宣称模型判断正确。
