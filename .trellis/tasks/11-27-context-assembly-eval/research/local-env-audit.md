# 本机环境与基线代码核查记录

**核查日期：** 2026-11-27
**核查范围：** Git 分支状态、`main` 基线源码、本机 macOS 工具链与已有配置目录（仅检查路径与版本，未读取任何密钥或私有配置）。

---

## 1. Git 与工作区隔离状态

- 主工作目录 `/Users/lau/workspace/berserk` 当前位于 `feat/model-management-ux` (`0e0f1c3`)，存在 **27 处未提交变更**（含 1 个未跟踪文件 `experiments/harness-lab/src/web/SettingsDrawer.tsx`）。
- 为保护主工作区未提交开发工作，遵循仓库已有 worktree 隔离惯例（参考 `.trellis/tasks/11-19-model-provider-integration/research/validation.md`），从 `main` (`3a991e8 合并：多对话模型选择与默认模型机制优化`) 创建独立 worktree 与分支：
  - 分支：`exp/context-assembly-eval`
  - 独立目录：`/Users/lau/workspace/berserk-context-assembly-eval`
- 主工作目录 `/Users/lau/workspace/berserk` 保持完全原状。

---

## 2. 本机 CLI 工具链与配置目录盘点（2026-11-27 实测）

| 项目 | 实测状态 | 备注 |
| --- | --- | --- |
| 操作系统 | macOS（Mac Mini） | 装有 `Clash Verge.app`、`Google Chrome.app`、`CC Switch.app`、`ChatGPT.app`、`Antigravity.app` |
| Homebrew | 已安装 (`/opt/homebrew/bin/brew`) | `/opt/homebrew/opt/` 当前为空 |
| `node` / `npm` / `pnpm` | 系统 PATH 未安装 | `experiments/harness-lab/package.json` 要求 `"engines": { "node": ">=24 <25" }`；仅 Codex 应用内部存在私用 runtime，系统尚未安装 `node@24` |
| `python3` | 已安装 (`/usr/bin/python3`, Python 3.9.6) | 满足 Trellis 脚本运行 |
| `docker` | 未安装 | 本实验不依赖容器沙盒工具，无需安装 Docker |
| `opencode` | 未安装 | `~/.config/opencode` 与 `~/.local/share/opencode` 均不存在 |
| `claude` (Claude Code CLI) | 未安装 | `~/.claude` 不存在 |
| `codex` (Codex CLI) | PATH 未安装 | **`/Users/lau/.codex` 目录已存在**，实验若运行 Codex CLI 必须通过 `CODEX_HOME` 与独立 `HOME` 严格隔离，严禁触碰 |
| `gh` | 未安装 | 通过 GitHub HTTPS API 核查过全部 Issue (#1–#22) |
| 仓库本地 `.env.local` | 未发现 | 主仓库根及 `experiments/harness-lab/` 均无 `.env` / `.env.local` |

---

## 3. `main` (`3a991e8`) 关键基线代码定位

- `experiments/harness-lab/src/contracts/model-presets.ts`：
  - 预置 `DeepSeek 官方` (`provider: 'deepseek'`, `baseUrl: 'https://api.deepseek.com'`, `api: 'openai-completions'`, `model: 'deepseek-flash'`)
  - 预置 `Kimi Code` (`provider: 'kimi-coding'`, `baseUrl: 'https://api.kimi.com/coding'`, `api: 'anthropic-messages'`, `model: 'kimi-for-coding'`, `defaultThinkingLevel: 'low'`, `compat: { forceAdaptiveThinking: true, allowEmptySignature: true }`)
- `experiments/harness-lab/src/server/config.ts#L52-L57`：`isVerifiedDeepSeekModel` 精确白名单。
- `experiments/harness-lab/src/pi/lab.ts#L1287-L1290`、`#L1328-L1339`、`#L1628`：原生 `agentsFilesOverride` + `<host_request_instructions>` 提醒生成与传入 `controlledStream`。
- `experiments/harness-lab/src/pi/controlled-stream.ts#L70-L78`：`onPayload` 中调用 `providerPayload` 并对 `isVerifiedDeepSeekModel` 在最后一条 `user` 前插 `role: 'system'`。
- `experiments/harness-lab/src/pi/model-runtime.ts#L29-L31`、`#L45-L52`：`thinkingFormat: 'deepseek'` 与旧版 `providerPayload` 按 `provider.toLowerCase() === 'deepseek'` 补 `thinking: { type: 'disabled' }` 的兼容分支。
