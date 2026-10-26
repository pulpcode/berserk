# C33：完整公开测试对话

来源：spatial-r2/live-20261018-r2-01/J12-baseline。所选声明第11行。真实历史候选，尚未人工确认；建议和人工标签不包含在评分输入中。

## 原生第6行 · user

仅针对本会话地图草稿：资源图层的点按设备类别（category）分类计数。只分析，不修改。

## 原生第7行 · assistant

我先读取本会话草稿，找到资源图层的对象，再按 category 分类计数。

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
      "setId": "1a0a6fa1-5d90-4351-b38c-a0059c6be730",
      "revision": 1
    },
    "title": "空间与标绘核对",
    "createdAt": "2026-10-18T03:30:33.802Z",
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

需要读取资源图层对象的 attributes 字段，才能按 category（设备类别）分类。

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
      "setId": "1a0a6fa1-5d90-4351-b38c-a0059c6be730",
      "revision": 1
    },
    "title": "空间与标绘核对",
    "createdAt": "2026-10-18T03:30:33.802Z",
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

## 资源图层分类计数结果

本会话草稿（revision 1）「资源」图层共 **5 个点对象**，按 `category`（设备类别）分类：

| 类别（category） | 数量 | 对象 |
|---|---|---|
| boat | 3 | 资源甲（r1）、资源丙（r3）、资源外（outside） |
| truck | 1 | 边界点（edge） |
| （未设置 category） | 1 | 资源乙（r2） |

补充说明：
- 资源乙（r2）没有 `category` 属性，属于「未设置类别」，不算作零而是字段缺失，与某类别「无对象」不同。
- 本结果是基于草稿标注对象自身携带的 `attributes.category` 字段统计，未涉及来源态势系统，也未进行任何空间运算。

只做了分析，未对草稿做任何修改。

