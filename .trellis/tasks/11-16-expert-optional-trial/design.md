# Design

## Approved boundary
行为差距由 contracts/capability-management.ts、server/capability-management-routes.ts、capabilities/management.ts 和 web/CapabilityManagement.tsx 拥有。web/ExpertTrial.tsx 仅改可选提示，不改运行器。

## Flow and contracts
- PublishExpertInput.trialId?: string；ExpertPublication.trialId?: string。路由仍拒绝多余字段，并保持其余 required；trialId 存在时仍按 UUID 校验。
- publish 在原锁、权限和 CAS 下校验当前草稿、validation、风险、scope。无 trialId 不查询/创建试用，也不检查文件环境成功证据。
- 显式带 trialId 的旧客户端仍进入原证据核对路径，含 expert/owner/draft/validation/status/evidence/confirmedAt；异步 blob 提交回调再次检查当前试用确认。取消文件环境发布门槛。
- 原发布记录仅在有真实合格试用时保留 trialId，否则省略；不添加 schema 或平行状态。不重写旧记录。
- 页面不因试用状态禁用发布；仅自动带入与当前 draftDigest 和 validationId 同时匹配的成功且已确认试用。无匹配时省略 trialId，避免旧证据阻断新校验发布。
- 实施核对发现原管理详情返回所有管理员试用，但直接试用读取受 owner 守卫约束。仅在既有详情 GET 路由按当前管理员过滤 trials，防止页面自动引用他人的确认记录导致可选发布失败；不修改内部 get/list 或公开发布元数据。
- 编辑、检查、历史和范围沿用现有布局；保留试用失败/未确认等真实状态。发布复选框不再声称已核对试用结果。

## Files
上述 5 个源文件及 tests/capability-management.test.ts、capability-management-api.test.ts、e2e/capability-management.spec.ts；必要时调整相关安全/同步测试。同步 backend/capabilities-r2.md、capabilities-r3.md、authoring-r3a.md 和 frontend/harness-lab.md 中现行契约。

## Compatibility and operations
旧请求带合格 trialId 继续工作；旧发布记录原样读取。optional 字段存于原 JSON，不需要表结构迁移。用原 metadata 读取路径验证新旧记录跨重启兼容。保持原幂等输入键，旧同 action+input 重试返回原效果。
本轮不部署。未来如部署，先独立备份程序/完整数据，审阅与并行 R3A 的差异再整合；不把本分支当作 R3A 全阶段验收或覆盖其他工作。
