---
'@ant-chat/backend': patch
'@ant-chat/desktop': patch
---

修复单实例锁把"PID 已被系统复用"误判为"ant-chat 仍在运行"导致的启动卡死

- 锁文件（`.runtime.lock`）与端点元数据（`.control-endpoint.json`）现在记录进程启动时刻 `startedAt`
- 冲突检测除 `process.kill(pid, 0)` 探测外，比对 PID 当前进程的真实启动时刻（Windows 用 PowerShell CIM 读 CreationDate，macOS/Linux 用 `ps lstart`）：不匹配说明锁是崩溃残留且 PID 已被其他进程占用，视为陈旧锁自动清理并接管
- Windows 上对受保护系统进程探测返回 EPERM 不再无条件视为存活，同样走身份校验；查询失败或旧版锁缺少 `startedAt` 时保持保守拒绝，避免同一数据目录出现两个 Runtime
