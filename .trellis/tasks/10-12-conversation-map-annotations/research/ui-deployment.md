# 三栏地图 UI 发布记录（2026-10-13）

用户授权：先提交 Git，再修改 UI，最后更新线上服务；同一腾讯云目标的源码传输已有明确授权。初始基线先提交为 `cbf0628`。

- 地址：`http://49.232.156.14:4315/`
- 既有应用：`/home/ubuntu/axon-map-release-e073df6/experiments/harness-lab`
- 独立构建与验证目录：`/home/ubuntu/axon-map-release-e073df6/updates/map-workspace-ui-20261013`
- 发布时间：2026-10-13 11:35:00（Asia/Singapore）
- 备份：`/home/ubuntu/axon-map-release-e073df6/backup/map-workspace-ui-20261013T033459Z/code.tar.gz`
- 原进程 PID `4110772` 保持运行；未重启、未迁移数据库、未更改模型及凭据配置。

## 发布与校验

1. 发布包包含 309 个已跟踪或明确新增的项目文件；无 `.env.local`、`.env.auth.local`、实际凭据及运行数据库。源码包 SHA256：`2380dd8e20ba5fc4f1c0971c2c9ae9341eb4626a8009575db3b87467e3ff91d1`，883190 字节。
2. 全部暂存文件逐项 SHA256 校验通过；线上现有前端与依赖配置共 62 项匹配基线 `cbf0628`。仅 8 个 `src/web/` 运行文件发生变化，无后端和依赖差异。
3. 独立目录复用现有依赖执行构建，备份原 `src/web`、`dist`、package 文件；先复制新资源，再原子替换 `index.html`，保留旧哈希资源供已打开页面加载。
4. 发布前后四席位均成功登录、读取任务及退出；发布后任务标注列表/当前标注和现有会话草稿绑定读取成功。每席位 3 个任务；现有会话总体席 2、态势席 1；活动请求及后台作业均为 0。
5. SQLite schema 仍为 v10，`integrity_check=ok`。未执行业务写入、模型调用或实际标注编辑。
6. 15 个构建产物逐个经 HTTP 读取，字节与构建目录一致；入口匹配、JS MIME 正常、公网 `/api/health` 返回 `{ok:true}`。
7. Chrome 实际公网登录总体席，进入现有会话；对话/协同/地图切换、图层浮层开关通过，1440 与 1280 宽度无横向溢出，画布高 782px，页面错误为 0。等待渲染稳定后已目视确认真实 OSM 底图与来源态势正常显示。截图与简报保存于本地 `/tmp/berserk-map-ui-deploy/`。验证后退出测试登录，不发送消息。

## 回滚

从上述 `code.tar.gz` 恢复原 `src/web`、`dist` 和 package 文件到应用目录。新文件 `src/web/situation/canvas-workspace.css` 可按本次清单移除；旧入口不再引用它。优先恢复旧静态入口并保留资源；本次仅前端，无数据库回滚或服务重启要求。

本地验证口径见 `ui-validation.md`；远端 `deployment.json`、`pre-verification.json`、`post-verification.json` 和 `static-verification.json` 保留执行结果，均不含凭据。
