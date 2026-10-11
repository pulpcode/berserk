# 验证及部署记录

- `npm run typecheck`、`npm run lint` 通过。
- `vitest run tests/direct-access-config.test.ts tests/random-uuid.test.ts tests/server.test.ts tests/access.test.ts`：4 文件、25 测试通过。
- 线上最小补丁 `git apply --check` 通过，未包含本地未提交地图界面变更。
- 服务器 `npm run build` 通过（既有 chunk 大小提示）。
- 发布目录 `/home/ubuntu/axon-map-release-e073df6`；当前启动入口 `axon-map-resume.ts` 同步使用配置监听；`start.sh` 显式启用 IP HTTP。
- 回滚代码备份：`backup/direct-access-20261011T083213Z/code.tar.gz`。数据及账号未迁移。
- 重启后 `0.0.0.0:4315` 监听；服务 PID 3538639（仅当时记录）。
- 服务器内通过外部 Host 检查：健康、登录、两个 brand SVG、favicon 均 200；匿名任务接口 401；非白名单 Origin 403。
- 公网目标 `http://49.232.156.14:4315`。首轮公网 curl 与浏览器 ERR_EMPTY_RESPONSE，服务器抓包未看到请求；本机路由经过 utun4。
- 用户已确认腾讯云尚未放行 4315，将手动添加入站 TCP 4315 允许规则。待添加后公网复测，不宣称外部验收完成。

## 云端放行后复测（2026-10-11）

用户已添加全部 IPv4 来源的 TCP 4315 允许规则。通过公网地址直接请求（curl 禁用显式代理，无 SSH 转发）：健康接口 200 且 `{"ok":true}`、登录页 200、匿名任务接口 401 AUTH_REQUIRED。浏览器直接打开公网 `/login`，正常呈现 Axon 登录页、账号与密码输入框及登录按钮。公网连通验收通过；本轮未提交真实账号密码或执行模型请求。
