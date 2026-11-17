# R1 线上隔离环境真实沙箱验收

结论：真实文件与确认流程已补齐。使用线上服务器的独立目录、全新合成数据及已有方舟模型配置；不是将 R1 切换到正式服务。

## 环境与源码

- 服务器：tencent-server；独立源码目录 /home/ubuntu/axon-r1-acceptance-20261113。
- Node v24.14.0，Docker 26.1.3，既有 berserk-file-runtime:w01-5 镜像，容器 Python 3.12.11。
- 模型 volcengine-agent-plan / deepseek-v4.1-flash，复用已驻留服务器的配置，不传输本地凭证。
- 上传归档 SHA-256：898cb11223f2598c29a49b8298cbe2ca8bd7581b808242cb589152cb59cde00a。
- 产品 src、fixtures、package.json/lock、tsconfig 共308个文件与当前 worktree 指纹一致：2ebf487a2bdfa5517b42bb16fa9dd5916a594057514e9398dcfb59be9c392730。
- 运行期间没有发布正式代码、重启正式服务或迁移正式数据。临时回环控制端口45991已关闭，测试容器已清理，原有正式容器保留。

## 通过的真实验证

online-hitl-evidence.json，passed=true：

1. 实际 ask_user 提问，GET 刷新查询待答状态，回答后生成真实 Markdown 文件并交付。
2. 批准删除一次性测试文件后文件确实删除；重复响应未重复执行。
3. 拒绝后测试文件字节保持。
4. 取消后请求终止、文件保留。
5. 重开服务后问题及答案可查，没有重发任务。

online-files-evidence.json，passed=true：

1. CSV 上传后，模型在实际 Docker 中生成 Python、JSON、Markdown、XLSX、DOCX、PDF、PNG。
2. 显式交付已保存成果，实际下载 Markdown、Excel、PNG，并保存原始字节。
3. 新请求把金额10改为15，运行脚本后合计由60改为65；新交付更新，原下载副本字节不变。
4. reviewer 子 Agent 在独立上下文实际调用只读 read 核对文件，成功返回；不授予写/执行权限。
5. 同一工作区的新会话读取现有文件，返回65。
6. 重开服务后历史、普通文件及旧下载保留，无请求重放。

## 首次尝试与辅助入口

原 probe-files.ts 没有外部回答入口，模型的正常复合依赖检查触发确认等待；原现场保存在 /tmp/berserk-files-live-BZfxiX，未计通过。临时副本仅新增服务器127.0.0.1:45991入口，逐条读取并审阅具体命令后提交对应 interactionId/requestId 的批准；未放宽产品 Bash 规则，也未自动批准未知后续调用。确认原文和回执保存在 online-manual-confirmations.jsonl。

辅助入口初次字符串引号编译问题发生于模型调用前，修正后运行。该轮随后因人工核对等待累计触发探针自身600秒诊断时限，记录保存在 online-files-initial-timeout.json，未计通过。过程中模型曾修正其生成脚本的 openpyxl 边框用法；产品代码未修改。

全部已生成文件保留。之后使用新的明确测试请求交付这些文件，不重放原超时请求，再完成修改、子 Agent、新会话及重开验证。人工验收诊断时限延长至1800秒仅用于该临时续作探针，没有改变产品默认时限。续作报告明确记录这一过程。

本次补齐 R1-5 的真实沙箱/确认技术证据；产品交互验收仍结合已有109项浏览器回归。代码及任务记录等待用户审阅、手动提交，尚未作为 R1 正式发布。
