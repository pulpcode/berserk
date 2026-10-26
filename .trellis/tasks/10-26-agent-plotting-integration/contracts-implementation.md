# Agent 契约整合实施记录

## 改动边界

现有工具已经支持标号、方向、角色及 CAS，但符号选项只有名称，未说明标准/扩展及方向能力；整体替换 style/attributes 的含义与固定引用接续规则不足。

- `src/pi/annotation-tools.ts`：从共享目录生成简短符号描述，说明最小顶层修改与完整嵌套对象替换；补充目标身份及未保存输入边界。
- `fixtures/skills/map-annotations/SKILL.md`：在固定 Agent 基线规则上补充对象引用、符号选择、字段保留、并发变化核对。
- `tests/pi/annotations.test.ts`：验证目录描述、真实工具字段保留、缺省及清除、固定引用隔离和实际 CAS 冲突后重读。

不变更共享目录、API/服务合并语义、模型参数、Pi 状态机制、真实模型调用或其他 worktree。

## 完成与验证

- 共享目录保持不变；全部22项生成含名称、别名、标准条款/应用扩展、方向支持的schema描述。
- 新增4项实际Pi工具/服务测试，覆盖：仅改指定字段保留style/sourceRefs/originFeatureRef/业务null/空串及旧对象缺省；显式清除heading和业务键；真实并发写入触发CAS后重读保留其他最新字段；跨set同名同短ID的固定读取与当前草稿写入隔离。
- `npm test -- tests/pi/annotations.test.ts`：30/30 通过（2026-10-26，Node24）。首次运行新增合成来源夹具未提供测试凭证，1项失败；补合成token后全文件通过。无外部来源请求、无真实模型请求。
- `npm run typecheck`：通过。
- `npx eslint src/pi/annotation-tools.ts tests/pi/annotations.test.ts`：通过。
- `git diff --check`：通过。

## 边界与后续

上述验证使用受控provider流，实际执行原生Pi工具和AnnotationService并断言持久结果；只证明程序契约，不证明真实模型能稳定选择符号、澄清指代或在同字段冲突时主动询问。自然语言遵循度须由计划中的独立真实模型批次验证。本次不改CAS机制，不增加宿主语义判断/自动合并或新写入接口。

