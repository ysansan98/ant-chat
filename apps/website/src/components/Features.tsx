import {
  Bot,
  Brain,
  Globe,
  MessageSquare,
  Puzzle,
  Server,
  Shield,
  Terminal,
  Wrench,
} from 'lucide-react'
import AnimateInView from './AnimateInView'

const FEATURES = [
  {
    icon: Bot,
    title: '多 AI 提供商',
    description: '支持 Anthropic Claude、OpenAI GPT、Google Gemini、DeepSeek 等主流模型，兼容 OpenAI 格式的自定义 API',
  },
  {
    icon: Wrench,
    title: '工具系统',
    description: '内置文件操作、Shell 命令、文件搜索、目录浏览等工具，支持三级安全策略保护',
  },
  {
    icon: Shield,
    title: '安全策略',
    description: '三级模式（严格审批、混合、全自动），白名单系统，工作区隔离，防止路径逃逸',
  },
  {
    icon: Brain,
    title: '记忆系统',
    description: '持久化记忆（SOUL.md、USER.md、MEMORY.md），声明式存储，注入防护检测',
  },
  {
    icon: MessageSquare,
    title: '对话体验',
    description: '实时流式输出，Markdown 渲染（语法高亮、表格、Mermaid 图表），上下文自动压缩',
  },
  {
    icon: Server,
    title: 'MCP 协议',
    description: 'Model Context Protocol 扩展 AI 能力，支持 Stdio 和 HTTP/SSE 多传输协议',
  },
  {
    icon: Puzzle,
    title: '技能系统',
    description: '从 GitHub 或本地 ZIP 包导入技能，Agent 可自动安装所需技能',
  },
  {
    icon: Globe,
    title: '多端支持',
    description: 'Electron 跨平台桌面应用 + 纯浏览器 Web 应用，无需安装即可使用',
  },
  {
    icon: Terminal,
    title: '开发者友好',
    description: '40+ AI 专用组件，暗黑/亮色主题，Kami 纸感设计风格，完全开源',
  },
]

export default function Features() {
  return (
    <section id="features" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <AnimateInView className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold md:text-4xl">功能特性</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            开箱即用的 AI Agent，覆盖从对话到工具调用的完整链路
          </p>
        </AnimateInView>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <AnimateInView key={feature.title} delay={index * 100}>
              <div
                className="group h-full rounded-xl border border-border bg-card p-6 transition-all hover:border-accent/50 hover:shadow-md"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors group-hover:bg-accent/20">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
