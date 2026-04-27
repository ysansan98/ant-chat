# Ant Chat Agent V1 文档入口

## 推荐阅读顺序

1. [DESIGN.md](./DESIGN.md)：总体设计与边界。
2. [PHASES.md](./PHASES.md)：阶段索引。
3. 进入对应阶段目录查看实现细节和测试用例。

## 阶段目录

- [P1：工作区与内置工具](./phases/p1-workspace-native-tools/README.md)
- [P2：Agent Runtime 与审批](./phases/p2-agent-runtime-approval/README.md)
- [P3：Skill FS-first](./phases/p3-skill-fs/README.md)
- [P4：主窗口 UI Shell](./phases/p4-main-window-shell/README.md)
- [P5：设置独立窗口](./phases/p5-settings-window/README.md)
- [P6：组件栈迁移与收敛](./phases/p6-ui-stack-hardening/README.md)

每个阶段目录内：
- `README.md`：目标、范围、交付物、实现要点、验收标准。
- `TESTPLAN.md`：该阶段验收标准对应的测试用例。
