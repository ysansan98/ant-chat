# Visualization V1 Schema

`publish_visualization({ spec })` 接受版本为 `1` 的对象。完整字段以共享 Zod schema 为准；未知字段、递归节点、原始 markup、外部 URL、超限字符串和超限数据都会被拒绝。

## 最小结构

```json
{
  "version": 1,
  "title": "请求延迟",
  "summary": "比较不同阶段的平均延迟",
  "data": {
    "latency": [
      { "stage": "排队", "value": 12 },
      { "stage": "执行", "value": 38 }
    ]
  },
  "layout": { "type": "single" },
  "views": [
    { "type": "bar", "title": "阶段延迟", "data": "latency", "category": "stage", "value": "value" }
  ]
}
```

V1 支持 line、bar、area、scatter、stacked-bar、table、grid、timeline、swimlane、flow、state-machine、player 和 form 视图，以及 range、checkbox、select、radio、toggle、text、textarea 控件。表达式只能使用 schema 声明的比较、布尔、聚合和 state 引用节点，禁止可执行字符串。

地图、远程资源、任意 HTML/CSS/JS、`eval` 和自定义 SVG path 不支持。
