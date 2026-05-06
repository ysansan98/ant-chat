# Ant Chat Agent V1 阶段索引

> 阶段细节按目录拆分。每个阶段目录包含 `README.md` 和 `TESTPLAN.md`。

## 全局约束

- V1 不新增 Agent 执行过程表。
- 工作区配置使用 store 或本地配置文件保存，不进数据库。
- 现有 chat-only 能力不能回退。
- 未通过当前阶段测试前，不进入下一阶段。

## 阶段顺序

1. [P1：工作区与内置工具](./phases/p1-workspace-native-tools/README.md)
2. [P2：Agent Runtime 与审批](./phases/p2-agent-runtime-approval/README.md)
3. [P3：Skill FS-first](./phases/p3-skill-fs/README.md)
4. [P4：主窗口 UI Shell](./phases/p4-main-window-shell/README.md)
5. [P5：设置独立窗口](./phases/p5-settings-window/README.md)
6. [P6：组件栈迁移与收敛](./phases/p6-ui-stack-hardening/README.md)

## 阶段目录约定

每个阶段目录内：

- `README.md`：目标、范围、交付物、实现要点、验收标准。
- `TESTPLAN.md`：验收标准对应的测试用例。
