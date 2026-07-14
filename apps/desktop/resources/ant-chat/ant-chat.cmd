@echo off
rem 开发环境 launcher；生产构建会在 afterPack 中改写为应用内可执行文件路径。
pnpm exec electron apps/desktop --ant-chat-cli %*
