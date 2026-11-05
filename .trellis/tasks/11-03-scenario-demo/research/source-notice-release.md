# 双系统来报v3发布及方舟配置核验

2026-11-05（Asia/Singapore）已更新线上服务。发布代码7942276，业务实现67a3e90。

- 页面：http://49.232.156.14:4315/scenario-director
- 发布根：/home/ubuntu/axon-scenario-release-68dded362074。
- 服务/数据备份：backup/source-notice-20261105-230932。
- 模型配置备份：backup/ark-config-20261105-231158（受限目录，旧配置保留）。
- 核验摘要：服务器 source-notice-verification.json 与 ark-config-verification.json，不含Key。

已在兼容v2时锁定原活动演示并核清通知，发布v3定义及特情/态势显示名称；原活动实例、7条消息、9个已绑定任务、全部场景持久原始记录和原生历史保留，未新建演示或投放事件。旧导演导航taskCodes在跨定义版本时不再附加，属于既有展示投影；原始记录逐行校验一致。首次严格比较把该投影差异判为失败，已自动回退；后续同时校验完整原始场景记录与业务事实后发布成功。

既有部署私有context-config.json与background-config.json按已配置systemId/sourceId精确更新name，没有更换身份、凭据、权限或后台规则。新业务文案用于显式“重新演示”后的v3样例，旧证据不追改。

模型原为DeepSeek官网/deepseek-flash。凭据传输在自动审批要求具体授权后暂停；用户明确允许把指定本机方舟Key经SSH保存于该服务器私有配置（权限600、保留受限备份）后才执行。当前实际生效：

- provider：volcengine-agent-plan。
- model：deepseek-v4.1-flash。
- baseUrl：https://ark.cn-beijing.volces.com/api/plan/v3。
- 容量沿用获授权的本机配置：contextWindow1048576，maxOutputTokens393216。
- Key存在且与授权配置一致；私有配置权限600；临时传输文件已删除。没有Key进入仓库、输出或日志。
- 通过模型管理API核对实际生效provider/model/baseUrl，不只核对启动环境。

本次没有模型生成、付费连通性调用或规则启用；配置核验不代表已做远端鉴权/模型语义验收。
