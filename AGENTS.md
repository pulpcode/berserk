<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Git 提交约定

- 本项目所有 Git commit message 必须以中文为主体，包括标题和正文；技术名词、标识符及可选的 Conventional Commits 前缀可以保留英文。
- 自动生成的任务归档、会话记录等提交也遵循此约定。
- Trellis 自动提交保持关闭；记录与归档后审阅变更，再使用中文提交信息手动提交。

## Pi 集成约定

- 避免过度设计，优先复用 Pi 的原生机制、默认行为和公开 SDK，尽量保持与内核设计一致。
- 宿主仅补齐已明确需要的 Web、工作区、权限及执行环境适配。新增状态、持久记录、提示词或恢复机制前，先说明具体需求或验证发现的能力缺口，不为假设中的未来需求提前建设。
