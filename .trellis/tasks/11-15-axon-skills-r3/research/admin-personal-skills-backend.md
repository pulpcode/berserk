# 管理员个人正式对话技能授权修正

按用户后续决定，当前无业务席位管理员可在个人scope正式使用所有已发布启用组织技能；业务范围none/all/seats不适用于管理员个人使用。普通业务使用范围及业务任务隔离保持。

最小改动：SkillServiceOptions.authorizeUse返回可选的受信任administrator-personal使用域；PiLab在验证当前accountIdentity、管理员role、可选seatId确为其personalScopeId且未伪造canCollaborate=true后返回。allowed只绕过业务范围判定，仍解析并校验policy形状，并保留发布修订、状态、显式账号拒绝与异步后重新授权。无新客户端角色字段、无新表/状态/迁移。

src/skills/service.ts、src/pi/lab.ts为产品改动。tests/skills-api.test.ts将过时的管理员目录拒绝断言更新为可读；新tests/admin-personal-skills.test.ts四例通过真实认证/API/原生Pi与明确替身模型/Docker验证：未发布不入目录、policy-none个人实际选择方法和按需资源、只挂载已激活包只读、无业务工具、其他管理员/业务/公共任务及workspace/session/files/resources不可访问；指定范围与none管理员可用、业务范围仍生效，伪造scope/canCollaborate、停用、封禁、显式账号拒绝、损坏policy拒绝；revoke/disable发生在包IO期间返回前再次拒绝。

scripts/probe-skills-r3.ts过时拒绝断言更新为管理员个人范围可解析固定包、伪造业务范围仍拒绝，保留未授权业务主体拒绝；检查文案明确仅此解析事实。未重新执行付费方舟探针，不能把此次fake Docker记录称为真实容器证据。

最终四完整文件19/19通过15.03秒：admin-personal-skills、skills-api、skills-review、pi/skill-package-guards。定向ESLint通过。全局类型/lint/build和浏览器由父代理协调。

首轮两个新增夹具错误：公共任务漏填必需goal；把publication完整元数据误作package resolve返回结构，修正夹具后重跑。中间fake Docker runner对docker ps返回true被正常守卫判为不可用，修正替身使ps空输出、仅exists返回true，未修改执行产品或断言来掩盖失败；该中间原始日志被后续定向日志覆盖，原因在此如实记录。最终绿色日志和首轮原始失败日志均保留。

未修改UI、spec或父代理的文档；未提交、推送或部署。
