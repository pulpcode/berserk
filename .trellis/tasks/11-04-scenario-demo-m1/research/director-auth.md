# 专用导演席认证与迁移实现记录

日期：2026-11-04。范围为独立场景能力、身份投影、认证库兼容及离线开通；页面和导演API授权由其他实现部分完成。

## 已实现

- Identity新增可选controlScenarios，真实身份读取始终返回明确布尔值。席位control_scenarios默认0，不从任务/模型/总览或来源管理权推导。
- saveAccount显式true授予、false撤销；省略新能力保留原授权，新席位默认关闭。账号维护继续使旧登录失效，停用后身份不可用。
- 离线account命令增加--control-scenarios和--no-control-scenarios，互斥；未增加在线自助授权或创建任何正式账号。
- 认证库schema13—18分别保留原7—12的可选模块布局；共享映射由access/schema.ts维护。后台/持续研判/标绘迁移不降级该代际，已声明新代际而缺失能力列时拒绝打开。

## 验证

- 第一轮9个相关Vitest文件152项通过：director-access、access、seat-responsibilities、annotations、background/store、background/service、recipient-store、task-context、background/task-links。
- 新增HTTP身份断言后，access和director-access两文件23项通过，覆盖管理员默认无场景能力、当前会话身份重新读取授权及停用失效。
- 最后新增可选模块迁移保留授权断言后，director-access全部9项通过；包括旧v7/v8/v9/v10/v11/v12迁移、真实SQLite重开、身份/任务/会话保留及损坏拒绝。
- npm run typecheck通过；本模块涉及源文件及测试的定向ESLint通过。
- 从方案提交e4054a5提取旧版openDatabase，在隔离临时数据中实测新schema13被旧读取器以RESOURCE_STATE_INVALID拒绝；当前读取器可重开同一数据。
- 使用真实TTY在隔离临时目录执行三次account命令：显式授予→省略新参数维护→显式撤销，分别读取到true→true→false；任务管理和模型管理均保持false。临时账号、数据库及临时.env.auth.local已清理。

## 集成说明

- Host仍须同时校验配置指定directorSeatId和当前actor.controlScenarios；仅该布尔值不构成导演路由全部授权。
- 版本13/15是认证及认证+标绘布局；14/16保留后台升级中间布局；现有后台构造器完成持续表迁移后为17/18。不要直接用未归一化的版本数判断可选模块存在。
- 旧程序不认识13—18，回退须恢复匹配备份。没有对现有LAB数据、账号或运行权限执行迁移/开通。
