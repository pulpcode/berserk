# 整合实施与离线验证

2026-10-28。当前分支 `codex/agent-spatial-plotting`。没有真实模型调用、推送、部署或合入main。

## 合并内容

- `e7a8552`：将空间固定提交394e0c9合入标绘ba3fc69。
- `b863aed`：合入R16归档fc7fc2a，历史冻结源、成绩、失败和证据均保留。
- 唯一文本冲突在 `tests/annotations.test.ts`：两边都在文件尾新增测试。完整保留专业标号/信息性质测试和零名称匹配ID提示测试，没有删除断言。产品代码无需额外兼容修改。
- `contracts/annotations.ts` 合并后同时保留style/信息性质和nameLookupHints。空间service及结果封装文件与394e0c9一致，工具输入及产品Skill与ba3fc69一致。R15候选Skill仍在原评测目录，不作为默认产品Skill；旧R12未提交来源指引与resource-tools没有带入。

## 已完成检查

| 检查 | 结果 |
| --- | --- |
| TypeScript | 通过 |
| ESLint及依赖边界 | 通过 |
| Vite构建 | 通过，保留既有大于500KB分块提示 |
| 13个相关Vitest文件 | 230项通过 |
| 浏览器三文件 | 43项通过，3.9分钟；无重试 |

离线测试覆盖标绘读写、符号与信息性质、来源刷新、几何验证、对象变更保留、Pi原生调用、新旧结果封装、固定结果保存、分类和权限边界。原生Pi测试实际覆盖保存固定范围后补充plan/备注、新结果封装读取style/role，以及冲突后保留人工变更。未添加与已有实现重复的镜像测试。

命令从 `experiments/harness-lab` 执行：

```sh
npm run typecheck
npm run lint
npm run build
npx vitest run tests/annotations.test.ts tests/annotation-results.test.ts tests/annotation-from-source.test.ts tests/annotation-geometry.test.ts tests/annotation-edit-changes.test.ts tests/pi/annotations.test.ts tests/pi/spatial.test.ts tests/pi/provider-payload.test.ts tests/spatial-contract-boundaries.test.ts tests/spatial-point-classification.test.ts tests/map-symbol-contracts.test.ts tests/map-symbol-assets.test.ts tests/map-symbol-rotation.test.ts
AXON_E2E_PORT=5296 npx playwright test tests/e2e/spatial.spec.ts tests/e2e/annotations.spec.ts tests/e2e/map-symbols.spec.ts --workers=2
```

依赖通过本地node_modules软链接复用标绘worktree的同版本依赖；未复制或读取API密钥。浏览器使用本地服务、受控provider和瓦片夹具，检查真实地图和交互，不证明在线底图或真实模型准确率。

## 尚未通过的质量门槛

工程整合通过与模型正确率达标分开。现有模型选型、解释越界和评测器误停问题仍作为已知问题保留。R16八项完整、一项待定、279未执行不转记为整合版成绩。新版本真实测评须另行审阅分组、冻结版本与预算。

## 浏览器证据

43项全部通过，覆盖中澳本地瓦片夹具、三种底图、未完成绘制保留、固定结果重开/保存、专业符号、属性编辑、CAS冲突及桌面窄面板。截图在 `verification/screenshots/`，日志在 `verification/e2e.log`。人工查看冲突核对截图确认显式选择与表单展示正常。截图仅代表受控测试环境，不是线上底图可用性验收。
