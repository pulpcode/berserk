# 质量验证及发布

- `npm run typecheck`、`npm run lint` 通过。
- `npx vitest run tests/access.test.ts`：13 测试通过，涵盖匿名席位字段裁剪、启用状态、账号与席位 ID 不同的映射、密码隔离、无效选择、混合选择拒绝、原账号登录及权限隔离。
- `AXON_E2E_PORT=5197 CI=1 npx playwright test tests/e2e/access.spec.ts --workers=2`：8 测试通过，涵盖错误提示、切换清空密码、375px 布局、空列表、正常登录、退出和跨标签页同步。
- 初次浏览器测试误复用了端口 5187 的旧版本服务，已停止该轮并在独立端口重跑通过；未更改其他服务。
- 已同步其余浏览器用例的登录选择方式。线上仅发布 contracts/access.ts、server/auth.ts、web/Seats.tsx 和 web/styles.css 四个文件对应补丁及重建资源。

## 线上验收
- 2026-10-11 发布成功，服务器构建通过，重启健康检查 200。
- 回滚备份 `/home/ubuntu/axon-map-release-e073df6/backup/seat-login-20261011T084410Z/code.tar.gz`，保留原数据及密码。
- 公网浏览器打开 `http://49.232.156.14:4315/login`，显示情报席、总体席、筹划席、态势席四个选项，初始无选择。
- 使用一个明确无效的测试密码验证：显示“席位或密码不正确。”；切换席位后密码和错误提示清空，登录按钮禁用。
- 真实账号密码未重置；成功密码登录及身份隔离在独立数据的认证和浏览器回归中验证。
- 截图 `/tmp/axon-seat-login.png`。

## 测试密码更新
- 用户后续明确指定四个启用席位使用同一测试密码；通过一次性离线维护更新独立随机盐及现有 scrypt 哈希，未修改默认管理工具的密码长度规则。
- 更新前备份 `/home/ubuntu/axon-map-release-e073df6/backup/seat-passwords-1791708499856`；原权限及业务数据保留，旧认证会话撤销，服务器私有 credentials.json 同步更新并清空旧会话凭据。
- 新密码不写入仓库或本记录。
