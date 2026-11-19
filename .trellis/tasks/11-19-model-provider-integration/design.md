# 设计与变更边界

最小能力缺口是现有目录把每个模型当作 OpenAI Completions 且管理权属于业务席位。扩展现有配置存储和 ModelRuntime 注册，按平台和模型解析；Pi 仍持有上下文与 agent 生命周期。

## 责任

- server/config.ts、model-settings.ts 和 contracts 维护协议/兼容参数/能力、平台凭证和可用性，保留旧读取与稳定 profile ID。新 schema 的旧代码回滚需要配对配置备份。
- pi/model-runtime.ts 复用公开 SDK 注册适配器，统一 reasoning 解析供主回复、压缩、子任务、建议和工作识别使用。始终思考模型声明 off:null，避免 Pi 自动 disabled。
- lab.ts 在原生 systemPrompt 中保存 R4 动态指引，公共规则去除位置假设；controlled-stream.ts 只对精确验证 DS 组合插入额外快照提醒，压缩排除。
- auth/app/Settings/模型管理和选模 UI 贯通系统管理员权限与平台模型目录；现有 CSRF、作用域、会话归属、忙态保护保留。

平台字段包括 id/name/baseURL/api/credentialRef/compat/enabled；模型关联 platformId，具稳定 ID、显示名/remote ID、容量/输入/思考能力和覆盖参数。具体接口以实现中的共享契约为准，避免重复同一解析逻辑。为旧配置生成独立平台时保留旧凭证绑定与缺省 API。Kimi 可先登记停用、未确认容量，不伪造账号权益。

授权来源：用户 2026-11-19 明确批准附件修订方案加四项补充并实施；无需重复方案审批。
