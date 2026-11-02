# 第二批桌面兼容回归

2026-11-02，根代理在独立 localhost:5294 运行，测试使用 fakeRuntime，无真实模型请求。此证据为既有桌面行为回归，不声称新资源卡片或第三批交互已建设。

执行目录：experiments/harness-lab。

启动 Vite 使用 runner 配置加载器，cacheDir=/tmp/berserk-resource-query-vite，未向共享 node_modules 写缓存。测试后该 Vite 进程已关闭，没有停止其他服务。

```sh
AXON_E2E_PORT=5294 npm run test:e2e -- tests/e2e/spatial.spec.ts tests/e2e/annotations.spec.ts --grep 'native save preserves preview|v2 point classifications|native streamed publication result|compact editor retains hidden styles' --workers=1 --output=/tmp/task-resource-query-playwright
```

4/4 通过，49.8 秒：

- 固定发布结果流式展示与刷新后的历史一致，12.7 秒。
- 紧凑编辑器保留隐藏样式和元信息，10.8 秒。
- 显式保存保留预览几何，原结果读回可重新打开，10.5 秒。
- 旧 v2 点面分类及固定划分读回，8.9 秒。

本地端口与浏览器启动使用已批准沙箱提升；没有访问线上服务或真实模型。浏览器临时产物在 /tmp/task-resource-query-playwright。SQLite 实验性提示与 NO_COLOR/FORCE_COLOR 提示不影响通过。
