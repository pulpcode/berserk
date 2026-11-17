# R1 离线登记、管理员与迁移

所有命令从 experiments/harness-lab 执行。以下为操作说明，不代表已经对真实业务目录执行；测试仅使用临时数据。

## 新目录与受控配置

新空目录启动由服务初始化能力库和内置定义，不授予任何账号管理员角色。认证账号仍通过原 access:admin 维护。服务启动后的配置更新，以及部署维护使用受控的 sync 命令：

```sh
npm run capabilities:admin -- sync --data-dir /absolute/lab-data --service-stopped
```

相同内容重复登记幂等，内容改变产生新 revisionId，已绑定会话不改绑。该命令不接受普通用户上传，不创建网页发布功能，也不调用模型。已有旧会话但没有能力库时必须先迁移，sync 不会绕过边界。

## 管理员角色

```sh
npm run capabilities:admin -- grant --data-dir /absolute/lab-data --service-stopped --username existing-account
npm run capabilities:admin -- list --data-dir /absolute/lab-data --service-stopped
npm run capabilities:admin -- revoke --data-dir /absolute/lab-data --service-stopped --username existing-account
```

仅对已有启用账号授予账号级 administrator；撤销也可针对已经停用的账号。重复授予保持原授予时间。角色使用认证数据库中独立 capability_account_roles 表，不改变既有 PRAGMA user_version，不从席位名称、模型管理权或公共任务管理权推导。停用账号立即失去当前管理访问；授予、撤销不更改任何业务席位字段或任务可见性。旧数据的角色表在显式迁移时建立，没有角色表时检查拒绝管理访问。

## 旧数据升级

先完成已有 workspace/seat 格式迁移，使 workspace-index 明确登记会话的工作区与席位。能力迁移不会从孤立原生文件猜测归属。需要独立的空备份路径，其父目录已存在：

```sh
npm run migrate:capabilities -- --data-dir /absolute/lab-data --backup-dir /absolute/backups/before-r1 --dry-run
# 停止唯一使用该 LAB_DATA_DIR 的服务后执行：
npm run migrate:capabilities -- --data-dir /absolute/lab-data --backup-dir /absolute/backups/before-r1 --apply --service-stopped
```

dry-run 只读校验严格工作区索引、全部已登记原生会话、认证库完整性及部署技能/子角色；不创建目录、能力库、备份或迁移标记，不调用模型。孤立文件、缺失文件、损坏历史、新专家格式而能力库缺失都会阻止迁移。

apply 首先复制完整停服数据根，并逐普通文件校验大小和 SHA-256，包括二进制数据库；不覆盖不匹配的备份。然后持久化 migrations/capabilities-r1.json 的原参数、原清单和 prepared 阶段，分别记录认证角色迁移和能力库迁移的 prepared/completed。受控定义及旧会话白名单登记成功后才完成。历史原文和工作区索引不改写，旧会话只在以后明确续聊时为未来请求绑定历史兼容专家。

中断后始终用原 data-dir、backup-dir、原受控配置重新 apply；已准备的历史或归属发生变化则保留现场并阻断。prepared 状态阻止服务启动。已完成迁移重复 apply 只返回原结果，不重新扫描并把升级后的新会话纳入旧格式白名单。已有新能力库但没有原迁移报告的目录不能重新迁移以扩大旧会话范围。

## 回退

1. 停止升级后的服务，保留完整升级后目录用于核对，不以重跑消息恢复结果。
2. 使用匹配升级前提交 66d0cba 的程序和备份目录 before-r1 的完整副本启动独立实例；不要让旧程序打开升级后的活动数据。
3. 确认原账号、旧工作区和历史后再切换正式数据路径；保留备份原件。

测试证据：capability-admin.test.ts 与 capability-admin-migration.test.ts 在临时目录验证独立角色、不自动提权、旧 schema 版本不变、dry-run 字节不变、完整备份字节相同、准备阶段故障恢复和原 ID 保持。另见 rollback-proof.json：已使用真实 66d0cba 旧程序完成合成会话创建、新程序迁移续聊、完整备份恢复副本、旧程序打开及续聊的演练。真实模型现已按用户指定改用方舟，并通过三轮任务及独立新进程的一轮续聊；本地 Docker 不可用的限制已通过线上独立环境补齐，真实文件/确认验收通过，见 online-sandbox-acceptance.md。
