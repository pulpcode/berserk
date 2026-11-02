# 最终离线检查口径

执行目录：`experiments/harness-lab`。真实模型调用0。

| 批次 | 实际结果 | 处理 |
|---|---|---|
| 统一30文件 | 408项：355过、53失败 | 51本地监听EPERM，2目录能力遗漏；原JSON/log保留 |
| 受影响8文件 | 82/82过 | 批准本地监听、修目录后复验 |
| HTTP修复2文件 | 19/19过 | 新增1项HTTP路径验证 |
| 最终去重 | 30文件409/409过 | 按文件+完整名称+同名参数序号；后跑替换前跑 |
| UI桌面 | 14个不同用例过 | 6新增+8原回归，详ui-checks |
| 模型设置桌面 | 1个不同用例过 | HTTP保存high、旧缺省及不调用provider；缩放复验不加分母 |

主要命令：

```sh
npx vitest run --configLoader runner --cache=false <30个文件，见diagnostics/b3-final-vitest.json> --reporter=default --reporter=json --outputFile=/tmp/b3-final-vitest.json
npx vitest run --configLoader runner --cache=false tests/task-resource-query.test.ts tests/context-resource-query.test.ts tests/context-composer-map.test.ts tests/pi/provider-payload.test.ts tests/pi/map-skill.test.ts tests/pi/skill-discovery.test.ts tests/pi/skill-metadata.test.ts tests/pi/task-resource.test.ts --reporter=default --reporter=json --outputFile=/tmp/b3-review-rerun-vitest.json
npx vitest run --configLoader runner --cache=false tests/pi/model-settings.test.ts tests/pi/model-catalog.test.ts --reporter=default --reporter=json --outputFile=/tmp/b3-http-fix-vitest.json
npm run typecheck
npm run lint
npm run build -- --configLoader runner --outDir /tmp/b3-review-final-dist
```

类型和lint在最终测试代码冻结后再次执行，exit0；构建在最终产品代码冻结后exit0，只有既有chunk体积提示。未为报告重复全量运行。最终测试与失败详情见diagnostics JSON/log。

模型设置浏览器：

```sh
AXON_E2E_PORT=5189 npx playwright test tests/e2e/model-selection.spec.ts --grep 'thinking settings preserve legacy' --workers=1 --output=/tmp/b3-model-settings-fixed-e2e
```

原生缩放补验：用diagnostics中的zoom-extension-manifest.json/worker.js还原到`/tmp/b3-native-zoom-extension/manifest.json`与`worker.js`，不安装到用户浏览器。实际命令：

```sh
AXON_E2E_PORT=5189 B3_VERIFY_BROWSER_ZOOM=true B3_ZOOM_EXTENSION=/tmp/b3-native-zoom-extension npx playwright test tests/e2e/model-selection.spec.ts --grep 'thinking settings preserve legacy' --headed --workers=1 --output=/tmp/b3-native-zoom-final-e2e
```

隔离Chromium实际tabs.getZoom严格为1.25，dpr变化，截图目视可用。首次快捷键无效与扩展默认禁用超时记录保留，不冒称首次全过。不新建产品压缩入口，不调用真实模型，不改变线上服务。

本轮独立Vite监听已停止：原session87546 Ctrl-C退出130；`lsof -nP -iTCP:5189 -sTCP:LISTEN`无输出（exit1），未停止其他服务。
