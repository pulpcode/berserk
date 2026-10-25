# C32：完整公开测试对话

来源：spatial-round1/live-20261017-r1-02/J12-1-FB。所选声明第13行。真实历史候选，尚未人工确认；建议和人工标签不包含在评分输入中。

## 原生第6行 · user

仅针对本会话地图草稿：资源图层的点按设备类别（category）分类计数。只分析，不修改。

## 原生第7行 · assistant

我先读取本会话草稿，确认资源图层和 category 字段。

工具：`annotation_read`

```json
{
  "mode": "draft"
}
```

## 原生第8行 · toolResult

```json
{
  "format": "annotation.model-result.v1",
  "data": {
    "status": "draft",
    "ref": {
      "setId": "3c1b9799-228f-4b40-877b-39f7aa1618cb",
      "revision": 1
    },
    "title": "空间与标绘核对",
    "createdAt": "2026-10-17T10:51:02.178Z",
    "layers": [
      {
        "layerId": "reference",
        "name": "参照对象",
        "order": 0,
        "defaultVisible": true
      },
      {
        "layerId": "resources",
        "name": "资源",
        "order": 1,
        "defaultVisible": true
      },
      {
        "layerId": "ties",
        "name": "并列",
        "order": 2,
        "defaultVisible": true
      },
      {
        "layerId": "derived",
        "name": "派生",
        "order": 3,
        "defaultVisible": true
      }
    ],
    "objects": {
      "items": [
        {
          "objectId": "origin",
          "name": "基点",
          "kind": "point",
          "layerId": "reference"
        },
        {
          "objectId": "north",
          "name": "北点",
          "kind": "point",
          "layerId": "reference"
        },
        {
          "objectId": "line",
          "name": "巡查线",
          "kind": "line",
          "layerId": "reference"
        },
        {
          "objectId": "return-line",
          "name": "往返线",
          "kind": "line",
          "layerId": "reference"
        },
        {
          "objectId": "region",
          "name": "观察区",
          "kind": "polygon",
          "layerId": "reference"
        },
        {
          "objectId": "excluded",
          "name": "禁入区",
          "kind": "polygon",
          "layerId": "reference"
        },
        {
          "objectId": "empty",
          "name": "空区",
          "kind": "polygon",
          "layerId": "reference"
        },
        {
          "objectId": "amb-a",
          "name": "集合点",
          "kind": "point",
          "layerId": "reference"
        },
        {
          "objectId": "amb-b",
          "name": "集合点",
          "kind": "point",
          "layerId": "reference"
        },
        {
          "objectId": "r1",
          "name": "资源甲",
          "kind": "point",
          "layerId": "resources"
        },
        {
          "objectId": "r2",
          "name": "资源乙",
          "kind": "point",
          "layerId": "resources"
        },
        {
          "objectId": "r3",
          "name": "资源丙",
          "kind": "point",
          "layerId": "resources"
        },
        {
          "objectId": "edge",
          "name": "边界点",
          "kind": "point",
          "layerId": "resources"
        },
        {
          "objectId": "outside",
          "name": "资源外",
          "kind": "point",
          "layerId": "resources"
        },
        {
          "objectId": "tie-b",
          "name": "并列乙",
          "kind": "point",
          "layerId": "ties"
        },
        {
          "objectId": "tie-a",
          "name": "并列甲",
          "kind": "point",
          "layerId": "ties"
        }
      ],
      "offset": 0,
      "limit": 50,
      "total": 16,
      "hasMore": false
    },
    "query": {}
  }
}
```

## 原生第9行 · assistant

资源图层有 5 个点，需要读取各点的 category 属性。

工具：`annotation_read`

```json
{
  "mode": "draft",
  "layerIds": [
    "resources"
  ],
  "fields": [
    "attributes"
  ]
}
```

## 原生第10行 · toolResult

```json
{
  "format": "annotation.model-result.v1",
  "data": {
    "status": "draft",
    "ref": {
      "setId": "3c1b9799-228f-4b40-877b-39f7aa1618cb",
      "revision": 1
    },
    "title": "空间与标绘核对",
    "createdAt": "2026-10-17T10:51:02.178Z",
    "layers": [
      {
        "layerId": "resources",
        "name": "资源",
        "order": 1,
        "defaultVisible": true
      }
    ],
    "objects": {
      "items": [
        {
          "objectId": "r1",
          "name": "资源甲",
          "kind": "point",
          "layerId": "resources",
          "attributes": {
            "status": "ready",
            "category": "boat"
          }
        },
        {
          "objectId": "r2",
          "name": "资源乙",
          "kind": "point",
          "layerId": "resources",
          "attributes": {
            "status": "ready"
          }
        },
        {
          "objectId": "r3",
          "name": "资源丙",
          "kind": "point",
          "layerId": "resources",
          "attributes": {
            "status": "ready",
            "category": "boat"
          }
        },
        {
          "objectId": "edge",
          "name": "边界点",
          "kind": "point",
          "layerId": "resources",
          "attributes": {
            "status": "ready",
            "category": "truck"
          }
        },
        {
          "objectId": "outside",
          "name": "资源外",
          "kind": "point",
          "layerId": "resources",
          "attributes": {
            "status": "busy",
            "category": "boat"
          }
        }
      ],
      "offset": 0,
      "limit": 50,
      "total": 5,
      "hasMore": false
    },
    "query": {
      "layerIds": [
        "resources"
      ],
      "fields": [
        "attributes"
      ]
    }
  }
}
```

## 原生第11行 · assistant

现在按 category 字段统计：

工具：`spatial_analyze`

```json
{
  "operation": "summarize",
  "input": {
    "kind": "annotation",
    "ref": {
      "setId": "3c1b9799-228f-4b40-877b-39f7aa1618cb",
      "revision": 1
    },
    "layerIds": [
      "resources"
    ]
  },
  "field": "category"
}
```

## 原生第12行 · toolResult

```json
{
  "code": "SPATIAL_ATTRIBUTE_MISSING",
  "message": "对象 资源乙 没有字段 category，不能当作不匹配。",
  "outcome": "not_committed"
}
```

## 原生第13行 · assistant

工具按规则拒绝了：资源乙没有 category 字段，缺失不能当成一类计数。我不做替换或猜测，直接从已读取的属性逐项汇总（这是同一草稿修订 r1 的固定内容，非重新计算）：

**结论（本会话草稿 r1，"资源"图层，共 5 个点）**

| 对象 | 名称 | category |
|---|---|---|
| r1 | 资源甲 | boat |
| r3 | 资源丙 | boat |
| edge | 边界点 | truck |
| outside | 资源外 | boat |
| r2 | 资源乙 | **缺失** |

- boat：3 个（资源甲、资源丙、资源外）
- truck：1 个（边界点）
- 缺失 category：1 个（资源乙，其属性只有 status=ready）

**说明与限制**
1. 平台的 summarize 统计因"资源乙"缺 category 字段而失败（错误码 SPATIAL_ATTRIBUTE_MISSING），工具明确拒绝把缺失值算作某个类别。上面的数字是我依据同一固定版本（setId 3c1b9799… revision 1）已读取的属性手工汇总的，不是工具统计回执。
2. 因此"5 个点中可归类 4 个"是可靠的；如果要 5 个全部归类，需先在标注中给资源乙补 category（属于修改，本次未做）。
3. 计数是"对象个数"，一个点只能说明一个该类别对象，不能据此推断实际车辆/艇只数量或运力。
4. 本次只读取和计数，未创建、修改、发布或采用任何版本；草稿仍为 revision 1。

如果你希望得到工具口径的正式分类统计，可以：给资源乙补上 category 后重新统计，或明确要求把缺失项单独作为"未分类"处理（需先写入草稿）。

