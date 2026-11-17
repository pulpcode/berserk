# 实现提交清单（待确认）

方案已提交 `a659c78`。以下为新增的一笔实现提交，后续用户已另行授权部署 4316 并等待测试；实现提交仍待确认，不推送、不归档尚待用户验收的任务。

拟提交信息：`feat: 实现对话输入建议预测`

本批次包含当前任务的独立预测接口、灰字与采纳交互、设置开关、测试、规范和验证记录。所有列出的文件均由本任务修改，无未识别或其他 worktree 的变更。验证详情见 [verification.md](verification.md)。

## 产品实现

```text
experiments/harness-lab/src/contracts/index.ts
experiments/harness-lab/src/contracts/prompt-suggestions.ts
experiments/harness-lab/src/pi/controlled-stream.ts
experiments/harness-lab/src/pi/lab.ts
experiments/harness-lab/src/pi/model-runtime.ts
experiments/harness-lab/src/pi/prompt-suggestion.ts
experiments/harness-lab/src/server/app.ts
experiments/harness-lab/src/web/ComposerReferences.tsx
experiments/harness-lab/src/web/PromptSuggestion.tsx
experiments/harness-lab/src/web/Settings.tsx
experiments/harness-lab/src/web/main.tsx
experiments/harness-lab/src/web/prompt-suggestion.ts
experiments/harness-lab/src/web/styles.css
experiments/harness-lab/src/web/useChat.ts
experiments/harness-lab/src/web/usePromptSuggestion.ts
```

## 测试

```text
experiments/harness-lab/tests/e2e/model-selection.spec.ts
experiments/harness-lab/tests/e2e/prompt-suggestion.spec.ts
experiments/harness-lab/tests/e2e/references.spec.ts
experiments/harness-lab/tests/pi/prompt-suggestion.test.ts
experiments/harness-lab/tests/prompt-suggestion-api.test.ts
experiments/harness-lab/tests/web/prompt-suggestion.test.ts
```

## 规范和任务记录

```text
.trellis/spec/backend/index.md
.trellis/spec/backend/prompt-suggestions.md
.trellis/spec/frontend/index.md
.trellis/tasks/11-16-input-predictions/check.jsonl
.trellis/tasks/11-16-input-predictions/commit-plan.md
.trellis/tasks/11-16-input-predictions/design.md
.trellis/tasks/11-16-input-predictions/implement.jsonl
.trellis/tasks/11-16-input-predictions/implement.md
.trellis/tasks/11-16-input-predictions/research/code-evidence.md
.trellis/tasks/11-16-input-predictions/task.json
.trellis/tasks/11-16-input-predictions/verification.md
```

项目 `.trellis/workflow.md` Phase 3.4 要求："Present the plan once, ask for one-shot confirmation"。此前授权的规划提交已完成；这笔实现提交等待本次清单确认。

## 当前提交授权
2026-11-17 用户明确要求“提交当前git”，授权一并提交输入建议与会话工作面板的当前阶段成果。合并提交信息：feat: 实现输入建议预测与三段工作面板。实现、测试、规格、语义评估及发布记录纳入同一提交；不推送、不归档，不表示用户验收完成。上文待确认清单保留为历史记录。
