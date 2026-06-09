<div align="center">

<img height="180" src="./apps/web/public/logo.svg" />

# Ant Chat

通用 AI Agent，支持多模型、工具调用、MCP 协议和技能扩展，提供桌面端和 Web 端

[![CI](https://github.com/whitexie/ant-chat/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/whitexie/ant-chat/actions/workflows/ci.yml)

[下载应用](https://github.com/whitexie/ant-chat/releases) | [功能特性](#功能特性-) | [开发指南](#开发指南-)

</div>

## 功能特性 ✨

### 🤖 多AI提供商支持

- **Anthropic Claude** - Claude系列模型
- **OpenAI** - GPT系列模型
- **Google Gemini** - Gemini Pro/Flash 系列
- **DeepSeek** - DeepSeek系列模型，支持深度思考过程显示
- **自定义 API** - 支持兼容OpenAI格式的API

### 🔧 工具系统

- **文件操作** - 读取、写入、编辑文件，支持精确文本替换
- **Shell 命令** - 执行 bash 命令，三级安全策略保护
- **文件搜索** - 基于 ripgrep 的 glob 和正则搜索
- **目录浏览** - 列出目录内容

### 🛡️ 安全策略

- **三级模式** - strict（严格审批）、hybrid（工作区自动放行）、full_managed（全部自动放行）
- **白名单系统** - 支持 glob 模式匹配，可记住审批决策
- **工作区隔离** - 强制工作区边界，防止路径逃逸

### 🧠 记忆系统

- **持久化记忆** - SOUL.md（身份）、USER.md（偏好）、MEMORY.md（笔记）
- **声明式存储** - 每条记忆以 `§` 前缀标记
- **注入防护** - 检测并拒绝包含 XML 标签的输入

### 💬 对话体验

- **实时流式输出** - 打字效果，支持推理内容展示
- **Markdown 渲染** - 语法高亮、表格、Mermaid 图表、代码预览
- **上下文压缩** - 自动压缩长对话历史，保留关键信息

### 🔌 MCP协议支持

- **Model Context Protocol** - 扩展AI能力的标准协议
- **多传输协议** - 支持 Stdio 和 HTTP/SSE
- **动态配置** - 灵活的MCP服务配置管理

### 🎯 技能系统

- **技能管理** - 安装、启用、禁用、删除技能
- **多来源** - 从 GitHub 或本地 ZIP 包导入
- **自主安装** - Agent 可自动从 GitHub 安装所需技能
- **内置技能** - 自带 skill-installer 技能，用于管理其他技能

### 🎨 用户界面

- **主题切换** - 暗黑/亮色主题，支持跟随系统
- **Kami 纸感主题** - 基于 shadcn/ui 的 Paper UI 设计风格
- **AI 专用组件** - 40+ 组件：推理链、工具调用、终端、代码块等

### 🌐 多端支持

- **桌面端** - Electron 跨平台桌面应用
- **Web端** - 纯浏览器应用，无需安装

## 技术栈 🛠️

### 核心框架

- **Electron** - 跨平台桌面应用框架
- **React 19** - 现代化前端框架
- **TypeScript** - 类型安全的JavaScript
- **Vite** - 快速构建工具

### UI组件

- **shadcn/ui** - 可复用UI组件库
- **TailwindCSS** - 原子化CSS框架
- **Kami 纸感主题** - Paper UI 设计风格

### AI集成

- **Vercel AI SDK** - 统一的AI模型调用接口，支持多家提供商

### 状态管理与存储

- **Zustand** - 轻量级状态管理
- **Drizzle ORM** - TypeScript优先的ORM
- **Better-SQLite3** - 高性能SQLite数据库

### 开发工具

- **ESLint** - 代码质量检查（@antfu/eslint-config）
- **Vitest** - 单元测试框架
- **simple-git-hooks** - Git hooks工具
- **Electron Builder** - 应用打包工具

## 安装使用 📦

### 预编译版本

1. 前往 [Releases](https://github.com/whitexie/ant-chat/releases) 页面
2. 下载适合你操作系统的安装包
3. 安装并启动应用

### 系统要求

- **macOS**: 10.15+ (Intel/Apple Silicon)
- **Windows**: Windows 10+ (x64)

## 开发指南 🚀

### 环境要求

- Node.js 22+
- pnpm 11+
- Python 3.x (用于node-gyp)

### 快速开始

```bash
# 克隆项目
git clone https://github.com/whitexie/ant-chat.git
cd ant-chat

# 安装依赖
pnpm install

# 启动开发环境
pnpm dev

# 构建应用
pnpm build:mac    # macOS
pnpm build:win    # Windows
```

### 项目结构

```
ant-chat/
├── apps/
│   ├── desktop/            # Electron 桌面应用
│   │   ├── src/
│   │   │   ├── main/       # 主进程
│   │   │   ├── preload/    # 预加载脚本
│   │   │   └── renderer/   # 渲染进程
│   │   └── ...
│   └── web/                # Web 应用
│       ├── src/
│       └── ...
├── packages/
│   ├── agent-core/         # 代理核心模块
│   ├── agent-runtime/      # 代理运行时
│   ├── app-data/           # 应用数据层
│   ├── local-server/       # 本地服务器
│   ├── mcp-client-hub/     # MCP 客户端中心
│   ├── shared/             # 共享类型和工具
│   └── ui/                 # UI 组件库 (shadcn/ui + Kami 主题)
├── out/                    # electron-vite 构建产物
├── release/                # electron-builder 发布产物
├── .github/                # GitHub Actions
└── docs/                   # 文档
```

### 开发脚本

```bash
# 开发
pnpm dev                  # 启动桌面端开发环境
pnpm dev:web              # 启动Web端开发环境
pnpm check                # 类型检查 + lint + 单元测试
pnpm type-check           # 类型检查
pnpm test:unit            # 运行单元测试

# 构建
pnpm build                # 构建桌面端
pnpm build:mac            # 构建macOS版本
pnpm build:win            # 构建Windows版本
```

## 贡献指南 🤝

我们欢迎任何形式的贡献！

### 提交问题

- 使用 GitHub Issues 报告bug或提出功能建议
- 提供详细的复现步骤和环境信息

### 代码贡献

1. Fork 项目仓库
2. 创建特性分支: `git checkout -b feature/amazing-feature`
3. 提交修改: `git commit -m 'feat: add amazing feature'`
4. 推送分支: `git push origin feature/amazing-feature`
5. 创建 Pull Request

### 开发规范

- 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范
- 确保代码通过 ESLint 检查
- 添加必要的单元测试
- 更新相关文档

## 许可证 📄

本项目采用 [MIT 许可证](./LICENSE) - 查看 LICENSE 文件了解详情

## 致谢 🙏

感谢以下优秀的开源项目：

- [Kami](https://github.com/tw93/kami) - 纸感设计风格灵感来源
- [shadcn/ui](https://github.com/shadcn-ui/ui) - 可复用UI组件库
- [lobe-ui](https://github.com/lobehub/lobe-ui) - 流式渲染速率控制实现参考
- [Electron](https://electronjs.org/) - 跨平台桌面应用框架
- [React](https://reactjs.org/) - 用户界面库

---

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！**

[报告问题](https://github.com/whitexie/ant-chat/issues) · [功能建议](https://github.com/whitexie/ant-chat/issues) · [参与讨论](https://github.com/whitexie/ant-chat/discussions)

</div>
