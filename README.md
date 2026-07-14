<div align="center">

<img height="160" src="./apps/web/public/logo.svg" />

# Ant Chat

本地优先的 AI Agent 客户端，支持多模型、工作区工具、MCP、技能和桌面/Web 双端运行。

[![CI](https://github.com/whitexie/ant-chat/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/whitexie/ant-chat/actions/workflows/ci.yml)

[下载应用](https://github.com/whitexie/ant-chat/releases) · [快速开始](#快速开始) · [开发](#开发)

</div>

## Ant Chat 是什么

Ant Chat 不是只调用模型的聊天壳。它把对话、工作区、文件工具、命令执行、MCP 服务、技能和记忆放在同一个本地运行时里，让 AI 可以围绕一个真实项目持续工作。

项目采用 TypeScript Monorepo：

- 桌面端使用 Electron，适合直接访问本机文件、命令和系统能力。
- Web 端运行在浏览器里，通过本地服务访问同一套运行时和数据。
- 核心能力沉在 packages 中，桌面端和 Web 端共享应用运行时、Agent Runtime、数据层和 UI 组件。

当前版本仍处于 alpha 阶段，适合本地使用、开发验证和功能迭代。

## 核心能力

- 多模型接入：支持 OpenAI、Anthropic Claude、Google Gemini、DeepSeek，以及兼容 OpenAI API 格式的自定义服务商。
- 工作区对话：对话归属到工作区，可切换工作区、搜索文件、引用上下文并管理历史会话。
- Agent 工具：内置文件读取、目录浏览、glob、grep、文件写入、精确编辑、Shell 命令和可选浏览器工具。
- 权限策略：提供 strict、hybrid、full_managed 三种模式；文件和命令操作会按工作区范围与策略决定是否审批。
- MCP 扩展：支持配置、连接、断开 MCP Server，并暴露可用工具给 Agent 使用。
- 技能系统：支持安装、启用、禁用、删除技能，并可重建技能索引。
- 记忆系统：管理 SOUL、USER、MEMORY 等记忆文件，支持回滚身份记忆。
- npm 产品包：`ant-chat` 同时提供 Agent Runtime、Web UI、RPC API、SSE 和控制 CLI。

## 运行方式

| 方式 | 入口 | 适合场景 |
| --- | --- | --- |
| 桌面端 | `pnpm dev` / Releases 安装包 | 日常使用、本机项目协作、需要 Electron 能力 |
| Web 开发 | `pnpm dev:web` | 调试浏览器端 UI 和本地服务集成 |
| npm 产品包 | `npx ant-chat` | 启动本地 Agent Runtime、Web UI、RPC、SSE 和控制 CLI |

Web 端必须搭配本地服务运行。服务默认监听 `http://127.0.0.1:3456`，数据保存在 `~/.ant-chat`。

```bash
npx ant-chat
ant-chat start --port 8080
ant-chat --host --port 8080
ant-chat settings show --json
```

`ant-chat settings`、`provider`、`mcp` 和 `automation` 只连接已有 Runtime，不会隐式启动第二个服务。
`--data-dir` 可以覆盖默认的 `~/.ant-chat`，也可以使用 `ANT_CHAT_DATA_ROOT`。同一数据目录只允许一个 Runtime 实例。

`--host` 会监听 `0.0.0.0`。当前 HTTP Web UI、RPC 和 SSE 没有鉴权，只能用于可信局域网或受控网络，禁止直接暴露到公网。

## 快速开始

环境要求：

- Node.js 20+
- pnpm 11+
- Python 3.x，用于编译 `better-sqlite3` 等原生依赖

```bash
git clone https://github.com/whitexie/ant-chat.git
cd ant-chat
pnpm install
```

启动桌面端：

```bash
pnpm dev
```

启动 Web 端和本地服务：

```bash
pnpm dev:web
```

启动后，在应用设置中添加服务商、API Key 和模型，再选择工作区开始对话。

## 开发

常用命令：

```bash
pnpm dev             # 启动 Electron 桌面端
pnpm dev:web         # 启动 Web 端和本地服务
pnpm type-check      # TypeScript 项目检查
pnpm lint            # ESLint 检查
pnpm test:unit       # Vitest 单元测试
pnpm check           # type-check + lint + test:unit
pnpm build           # 构建 packages 和桌面端
pnpm build:mac       # 打包 macOS 应用
pnpm build:win       # 打包 Windows 应用
pnpm rebuild:node    # 重建原生依赖
```

提交前请运行：

```bash
pnpm check
```

## 项目结构

```text
ant-chat/
├── apps/
│   ├── desktop/            # Electron 桌面应用
│   │   └── src/
│   │       ├── main/       # 主进程、IPC、应用生命周期
│   │       ├── preload/    # preload bridge
│   │       └── renderer/   # 复用 Web 端渲染代码
│   ├── web/                # 浏览器端 UI
│   └── website/            # 项目官网
├── packages/
│   ├── backend/            # 后端运行时、Agent、数据、MCP 和 RPC handlers
│   ├── ant-chat/            # npm 产品包、Web 本地服务、RPC API、事件流和 CLI
│   ├── control-client/      # Desktop 与 npm 产品共用的控制面客户端
│   ├── shared/             # 共享类型、schema、常量
│   └── ui/                 # shadcn/ui 组件和 Kami 主题
└── docs/                   # 设计、计划和项目文档
```

## 技术栈

- Electron、React 19、Vite、TypeScript
- Vercel AI SDK
- Zustand、Drizzle ORM、Better-SQLite3
- shadcn/ui、TailwindCSS、Kami 纸感主题
- Vitest、ESLint、simple-git-hooks、electron-builder

## 贡献

欢迎提交 Issue 和 Pull Request。请保持变更范围小、行为明确，并在涉及功能变化时同步更新文档。

提交建议：

- 使用 Conventional Commits 风格，例如 `feat: add workspace search`。
- UI 变更附截图或录屏。
- 配置、数据结构或运行方式变化需要写清楚迁移影响。
- 版本发布相关变更使用 Changesets：`pnpm changeset`。

## 许可证

[MIT](./LICENSE)

## 致谢

- [Kami](https://github.com/tw93/kami)
- [shadcn/ui](https://github.com/shadcn-ui/ui)
- [Vercel AI SDK](https://ai-sdk.dev/)
- [Electron](https://electronjs.org/)
- [React](https://react.dev/)
