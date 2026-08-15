---
'@ant-chat/backend': patch
'@ant-chat/desktop': patch
---

修复 Windows 下 fsync 只读/目录句柄导致的 EPERM 崩溃（首次启动与每次设置写入必现），让桌面端 dev 在 backend 未构建时从源码目录拷贝内置技能，并让 rg:prepare 在本地只抓取当前平台的 ripgrep（避免 Windows 上 GNU tar 解压 macOS 包失败）。
