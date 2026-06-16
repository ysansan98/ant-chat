import { ArrowRight, SquareTerminal } from 'lucide-react'
import AnimateInView from './AnimateInView'

export default function Hero() {
  return (
    <section className="relative flex min-h-[85vh] items-center justify-center overflow-hidden px-6 pt-16">
      {/* 背景装饰 */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute right-1/4 top-1/2 h-[300px] w-[300px] rounded-full bg-primary/10 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-4xl text-center">
        <AnimateInView direction="down">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            开源免费，MIT 许可证
          </div>
        </AnimateInView>

        <AnimateInView delay={100}>
          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight md:text-7xl">
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Ant Chat
            </span>
          </h1>
        </AnimateInView>

        <AnimateInView delay={200}>
          <p className="mx-auto mb-4 max-w-2xl text-xl text-muted-foreground md:text-2xl">
            通用 AI Agent，支持多模型、工具调用、MCP 协议和技能扩展
          </p>
        </AnimateInView>

        <AnimateInView delay={300}>
          <p className="mx-auto mb-10 max-w-xl text-lg text-muted-foreground/80">
            桌面端 + Web 端，开箱即用的 AI 助手
          </p>
        </AnimateInView>

        <AnimateInView delay={400}>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="https://github.com/whitexie/ant-chat/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-medium text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl"
            >
              下载应用
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="https://github.com/whitexie/ant-chat"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border border-border bg-background px-8 py-3.5 text-base font-medium transition-all hover:bg-secondary"
            >
              <SquareTerminal className="h-4 w-4" />
              GitHub
            </a>
          </div>
        </AnimateInView>

        {/* 产品截图占位 */}
        <AnimateInView delay={500} direction="up">
          <div className="mx-auto mt-16 max-w-4xl rounded-xl border border-border bg-card p-2 shadow-lg">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
              <div className="h-3 w-3 rounded-full bg-red-400" />
              <div className="h-3 w-3 rounded-full bg-yellow-400" />
              <div className="h-3 w-3 rounded-full bg-green-400" />
              <span className="ml-2 text-xs text-muted-foreground">Ant Chat</span>
            </div>
            <div className="flex h-[400px] items-center justify-center rounded-lg bg-muted/50">
              <p className="text-muted-foreground">产品截图</p>
            </div>
          </div>
        </AnimateInView>
      </div>
    </section>
  )
}
