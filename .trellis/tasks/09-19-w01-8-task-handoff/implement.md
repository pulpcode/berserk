# W01-8 实施计划

状态：**待审，未开工**。实现须按本次设计审阅后的范围开展，不将长期平台能力混入本期。

## 实施顺序

| 步骤 | 交付及退出条件 |
| --- | --- |
| P1 席位与存储验证 | 单进程、共享 WorkspaceStore 支持不可变 ActorContext；两测试席位无串线。验证 Node 24.14.0 SQLite 短事务、故障回读和安全副本复制；保留旧 JSONL 与 v2 索引 |
| P2 分派与交接服务 | 实现 WorkItem、会话关联、准备单、Submission、状态与 revision 校验、固定副本和回执查询；页面／Agent 调用同一服务 |
| P3 Pi 工具和确认 | 注册查询、prepare／commit、受控资料导入工具；扩展现有业务确认卡片及解析；确认后提交，不新建 Agent loop 或完整 Run |
| P4 网页 | 席位切换、待办、分派表单、工作详情、准备预览、提交／退回；保留项目会话结构和已有输入体验 |
| P5 验收与交付 | H01～H16、必要全量回归及独立真实模型／Docker 验证；更新已实现规范与验收记录，按授权提交、备份发布 |

P1 若发现现有单进程索引或确认接口无法支持具体要求，应记录实际缺口并重新审阅必要改动，不以引入第二个共享数据的 PiLab 或全局切换 seatId 绕过。

开工前完整读取适用规范：当前 `backend/harness-lab.md` 超过 Trellis 单文件自动注入大小，不能以截断的上下文代替全文。

## 改动边界

路径相对 `experiments/harness-lab/`：

- `src/contracts/`：席位摘要、工作／准备单／提交 DTO 及确认卡片的可选业务摘要。
- `src/server/app.ts`、`file-routes.ts`、`config.ts`：统一测试席位路径、严格参数和当前 ActorContext；旧单席位模式兼容。
- `src/workspaces/store.ts`：一份索引、多席位范围及 ensureWorkspace；不改为多个内存索引或每席位单独服务。
- `src/pi/lab.ts`、资源／文件／交互集成：固定每次请求席位，按所有者读取原历史，挂接具体业务工具；保留 Pi 集中依赖边界。
- 新增 `src/collaboration/`：具体协作服务、SQLite 元数据、状态校验及交接文件。只封装本期动作，不建设通用工作流／存储适配框架。
- `src/files/`：复用受控复制原语和预览；跨席位固定副本经业务授权打开，不放宽原文件 API。
- `src/web/`：统一带席位的 API URL，覆盖 fetch、SSE、XHR 和下载；状态按席位隔离，新增工作入口。
- `tests/` 与显式探针脚本：领域状态、文件字节、权限、故障和真实闭环。

## 验证

```bash
npm --prefix experiments/harness-lab run typecheck
npm --prefix experiments/harness-lab run lint
npm --prefix experiments/harness-lab test -- --maxWorkers=2
npm --prefix experiments/harness-lab run test:e2e
npm --prefix experiments/harness-lab run build
git diff --check
```

- 单元／集成：状态转换、席位／任务权限、客户端幂等键、revision、提交副本、停止和数据库故障；禁止把“跳过”算通过。
- 浏览器：两席位切换、双标签页、迟到事件、上传／下载、准备预览、待办／会话关联、草稿、焦点和窄屏。
- 真实闭环：A 分派，B 通过模型读取资料并生成脚本／方案，确认提交，A 退回，B 修改重交，A 验收；对比两个固定版本。
- 崩溃：业务提交前后及 JSONL 保存前后分别强制退出；查回执、工作状态和真实文件，不补造模型结果。
- 升级：用旧数据副本启用测试席位，逐项读取既有会话和文件；数据库独立版本标记、停服备份和回退限制明确。

沿用已有 DeepSeek、SSH 和 Docker 配置，本次设计不需要新的密钥或服务器密码。正式实现若需要新增本地配置，再提供填写方式。

## 当前交付状态

已完成设计文档及代码研究，未写产品代码、未执行功能测试、未变更线上服务。当前工作区保留此前“回复完成”提示简化的未提交改动，不将它们计作本期实现。
