# P6：组件栈迁移与收敛

## 目标

- 移除 Renderer 运行时对 Ant Design / Ant Design X 的依赖。
- 使用 TailwindCSS + 无头组件库重建 UI。
- 完成 V1 收敛回归。

## 范围

- 基础按钮、输入框、菜单、弹层、开关、选择器。
- Chat / Sender / Settings / MCP / Workspace / Tools 页面迁移。
- 图标迁移到轻量图标库。
- 全流程回归、构建、稳定性验证。

## 交付物

- Renderer 不再 import `antd`、`@ant-design/icons`、`@ant-design/x`。
- package 依赖移除。
- V1 发布候选版本。

## 实现要点

### 迁移原则

- 不在本阶段改变产品行为，只替换 UI 组件实现。
- 优先迁移基础组件，再迁业务页面。
- 保持组件 API 简单，避免为迁移新增大抽象层。
- 图标使用轻量图标库，例如 `lucide-react`。

### 推荐迁移顺序

1. Button、Input、Select、Switch、Popover/Dialog、Tooltip、Menu。
2. Sender / Chat 基础交互。
3. Workspace / Tools Shell。
4. Settings Window。
5. MCP 管理页面。
6. 清理依赖和 dead code。

### 验证重点

- 浅色和深色主题。
- 弹层定位。
- 输入框、附件、模型选择。
- 长文本、窄屏、窗口缩放。
- Agent 进度列表和审批提示不遮挡输入框。

## 验收标准

- AC-P6-1：代码中无 Renderer 对 Ant Design / Ant Design X 的 import。
- AC-P6-2：依赖中移除 `antd`、`@ant-design/icons`、`@ant-design/x`。
- AC-P6-3：主窗口、聊天、设置、MCP、工作区、工具区可正常交互。
- AC-P6-4：浅色/深色主题显示正常。
- AC-P6-5：P1-P5 全部测试用例通过。
- AC-P6-6：type-check/build 通过。
- AC-P6-7：连续执行多次简单聊天和复杂任务无崩溃。
- AC-P6-8：异常退出后应用可正常重启。
- AC-P6-9：无阻断级或高优先级缺陷。

## 测试

见 [TESTPLAN.md](./TESTPLAN.md)。
