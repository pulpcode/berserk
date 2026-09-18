# W01-5 工程接入依据

日期：2026-09-18。基线：670cb3c。以下为设计研究，文件执行功能尚未实现。

## 现有工程与接入位置

源码路径相对于 `experiments/harness-lab/`。

| 位置 | 已核验事实与设计影响 |
| --- | --- |
| src/pi/lab.ts | createAgentSession 使用 noTools: 'builtin'，只注册资源及 subagent 工具；当前 cwd 为 LAB_DATA_DIR，不能直接在此启用 Shell |
| installed Pi docs/sdk.md | 锁定 @earendil-works/pi-coding-agent 0.85.1；默认内置 read、bash、edit、write；公开工厂与 operations 可用于执行位置适配，详见 [Pi 研究](pi-file-runtime.md) |
| src/pi/resource-tools.ts | 指令 CAS、取消收敛及自定义事件已有实现；保留此入口，不把 AGENTS.md 放进通用可写目录绕过规则 |
| src/pi/roles.ts、subagent-history.ts | 当前角色与历史严格校验只读工具；加入文件读取时需同步工具目录及历史解码，不能给子 Agent bash 后仍称只读 |
| src/workspaces/store.ts、src/resources/files.ts | 已有工作区索引、固定会话归属、受控文件和单进程约束；本期补任务 × 席位映射、普通文件与上传记录／下载存储，保留原 workspaceId，不迁移原生聊天 |
| src/server/app.ts | Fastify 默认 JSON bodyLimit=128 KiB；上传必须使用独立流式路由及限额，不能把文件塞进聊天 JSON，也不能全局扩大普通请求上限 |
| src/contracts/index.ts、src/web | 扩展附件、文件项、请求执行反馈和下载 DTO；前端不解析 Pi JSONL，也不拼接宿主文件路径 |
| .trellis/spec/backend/harness-lab.md、frontend/harness-lab.md | 描述已实现行为；批准并落地前不改写成“已支持”。旧“只接收 ID”“关闭内置工具”是既有范围；新文件 API 的受控相对路径是本期拟新增契约 |

## 执行环境依据

本期落地最小执行沙盒，设计采用请求级 Linux 容器：Pi、模型 API 调用与密钥留在应用服务端，文件与 Shell 操作在隔离环境中进行；只挂载本任务、本席位的工作目录。Docker 提供资源限制等基础机制，但项目还要实现目录挂载、取消收敛及生命周期；不能把 cwd 或 Docker 默认配置当成完整隔离。[Docker 运行文档](https://docs.docker.com/engine/containers/run/)

本机可发现 `/usr/local/bin/docker`。这仅证明 CLI 存在，未检查 daemon、镜像、挂载权限、磁盘配额或执行效果；没有安装／启动环境、创建容器或访问服务器。P0 必须验证这些条件及 Pi operations 适配。环境不可用时不回退为裸宿主命令执行。

本期不新建成果 SQLite 数据库。上传文件与脚本、中间产物同为席位工作目录中的普通可写文件，上传后无需再次发送才能生效，不另存只读原件；仅对话交付保存固定下载副本。轻量元数据使用宿主受控文件，聊天仍由 Pi JSONL 保存。没有同时迁移会话或建设业务状态库的必要。

任务 × 席位归属及上传语义来自用户讨论，不是 Pi 或竞品强制要求。固定测试席位仅用于当前实验阶段的范围验证；真实人员授权与交接后置。

同工作区会话按用户选择允许并行，沿用现有单会话活动请求限制；每个请求独立管理容器、取消及事件。文件冲突保护与独立工作副本后置，不为本阶段增加工作区请求队列。

## 需在 P0 验证的边界

- 工具 execute 的 ctx.cwd 与工厂 cwd、容器虚拟路径的一致映射。
- Pi bash 截断输出的宿主日志转为可读引用；保持原生截断行为，不暴露宿主临时路径。
- Python 子进程、命令遗留进程、取消／超时及宿主重启后的容器清理。
- 主 Agent 可写、子 Agent 只读，以及文件预览／下载路径不会绕过目录边界。
- 常见文档依赖、中文字体、容器 UID 与持久目录权限；资源限额与大文件传输。

竞品交互及适用范围见 [上传与文件交互研究](upload-ux.md)。这些研究不等于已经通过验收。
