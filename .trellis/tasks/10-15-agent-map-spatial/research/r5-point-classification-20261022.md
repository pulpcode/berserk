# R5 点面位置分类：实现与离线检查

日期：2026-10-22。范围：已批准方案第 9.3B 节。仅记录确定性检查；没有调用真实模型，没有执行后续 12 项测评。

## 实现了什么

在既有 `spatial_analyze` 中增加 `classify_points`，仍走原来的授权读取、固定版本、受限计算线程、原生历史和地图结果入口，不增加服务或存储。

```json
{
  "operation": "classify_points",
  "input": {"kind": "annotation", "ref": {"setId": "固定版本 UUID", "revision": 1}, "objectIds": ["候选点 ID"]},
  "target": {"kind": "annotation", "ref": {"setId": "固定版本 UUID", "revision": 1}, "objectIds": ["区域 ID"]}
}
```

`input` 必须全部为点；`target` 必须恰好一个 Polygon，可含孔。程序逐点返回：

- `interior`：严格内部；
- `boundary`：外环或内环的边、顶点；
- `exterior`：外部，包含孔内部。

结果保留原 `items`、`referenceItems`、完整身份、原始几何、固定版本和来源时间，另加：

```json
{
  "schemaVersion": 2,
  "operation": "classify_points",
  "classifications": [
    {"itemId": "items 中的完整 id", "position": "boundary"}
  ],
  "values": {"total": 1, "interior": 0, "boundary": 1, "exterior": 0}
}
```

`classifications` 与 `items` 一一对应且顺序相同；分类数量与候选总数一致。模型文本仍省略坐标，使用 `spatial.model-result.v2`。地图面板显示三类数量，并在每个对象旁显示所属类别；定位和地图几何继续复用现有逻辑。

## 算法依据与限制

实际读取本地已安装的 `@turf/boolean-point-in-polygon@7.2.0` 源码：`dist/esm/index.js` 调用 `point-in-polygon-hao`；当返回值为 0（边界）时，根据 `ignoreBoundary` 返回 false 或 true。锁文件中该底层依赖为 1.2.4。

实现先判断含边界覆盖，再判断排除边界的内部，得到三个互斥类别。没有加米级或经纬度容差；距离边界很近不等于位于边界。使用经纬度线段拓扑，不声称测绘级精度。

独立真值来自人工可判定的矩形、带矩形孔的面及三角形，不以同一个 Turf 函数生成预期结果。验证了外环/孔的边与顶点、孔内、面外、边界两侧相距 `1e-10` 度的点、环方向反转和斜边。

新操作明确拒绝 MultiPolygon 和非点候选。原 `contains/intersects/disjoint` 对 MultiPolygon 的支持和原有边界语义不变。复用原有单几何/点面组合跨度、纬度、无效几何、总对象/顶点、结果字节数、工作线程数量与超时限制。500 个总输入对象包含参照区域，因此单次至多 499 个候选点加 1 个区域；没有把超过上限的对象算为外部。

**入口限制仍然存在：** 当前 ContextService 的 area 响应与标绘写入仅支持单环 Polygon；本次没有扩大这两个入口。带孔区域可通过原有可信固定分析结果进入计算。服务测试分别覆盖真实来源单环面和由授权结果解析器提供的带孔面；后者是确定性服务测试夹具，不声称本次增加了外部带孔数据导入能力。

## 历史与结果兼容

- 只有新操作产生 `schemaVersion:2` 和 `spatial.model-result.v2`；原操作继续产生 v1，原模型投影字段及排列不变。
- 共享解码器分别限制两个版本：v1 不允许新分类字段或新操作；v2 只允许 `classify_points`，并核对身份覆盖、类别枚举、整数计数、总数、点输入、单 Polygon 参照和模型文本一致性。
- 读取旧记录保留当时的方法、限制、几何和数值，不重新计算或补分类字段。新记录读取同样保留原结果，只有现有 delivery 字段描述本次读取归属。
- 新结果可按原机制引用 `items` 继续统计，或选择一个原结果点精确保存；参照 Polygon 不是候选，不进入计数。
- 新旧原生记录共存、进程重启后重开、读取 v2、复用 v2 的原对象进行 v1 统计及精确保存均已检查。
- 旧二进制不认识 v2，不能在已有 v2 会话数据上直接回滚；需要保留兼容读取版本或使用停机备份。没有历史迁移或自动重写。

## 错误提示接入

根据主会话提供的共享 `methodAdvice`，`spatial-tools.ts` 只在已知、未提交的错误中附带可用方法入口。现有错误码、恢复信息和结果不变，不自动读方法、重试或拦截合法操作。新测试核对不支持几何错误在真实 Pi 工具结果中包含 `spatial-analysis` 入口，同时没有产生 `skill_read`；已有不确定保存路径不增加提示。

本次 8 项主动读取对照将由主会话从冻结的独立运行时实施，排除本分类工具和错误提示的混入；这里的离线实现不代表已测量其模型收益。

## 检查结果

- `npx vitest run tests/spatial-point-classification.test.ts tests/pi/spatial.test.ts tests/spatial-map-ui.test.ts tests/spatial-contract-boundaries.test.ts tests/spatial-math-oracles.test.ts tests/spatial-source.test.ts`：**6 份文件、97 项通过**。
- `npm run typecheck`：通过。
- `npm run lint`：通过，包含 Pi/浏览器依赖边界检查。
- `git diff --check`：通过。
- 新增 `tests/e2e/spatial.spec.ts` 中的 v2 分类显示、实际几何身份和刷新重开用例；由主会话统一执行，本文不提前记录为通过。

准备过程中修正了新测试的括号、点几何类型，以及不符合既有来源响应契约的夹具。最终以上检查已通过；没有为通过测试放宽生产来源校验或修改旧语义。

## 文件

产品：`src/contracts/spatial.ts`、`src/spatial/calculation.ts`、`src/spatial/geometry.ts`、`src/spatial/service.ts`、`src/pi/spatial-results.ts`、`src/pi/spatial-tools.ts`、`src/web/situation/AnalysisPanel.tsx`。

测试：新增 `tests/spatial-point-classification.test.ts`；补充 `tests/pi/spatial.test.ts`、`tests/spatial-map-ui.test.ts`、`tests/e2e/spatial.spec.ts`。本记录未提交 Git，交由主会话统一审阅。
