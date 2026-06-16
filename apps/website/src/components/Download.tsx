import { Apple, ExternalLink, Monitor } from 'lucide-react'
import AnimateInView from './AnimateInView'

export default function Download() {
  return (
    <section id="download" className="px-6 py-24">
      <div className="mx-auto max-w-4xl text-center">
        <AnimateInView>
          <h2 className="mb-4 text-3xl font-bold md:text-4xl">下载应用</h2>
          <p className="mb-12 text-lg text-muted-foreground">
            支持 macOS 和 Windows，选择适合你操作系统的版本
          </p>
        </AnimateInView>

        <div className="mb-12 grid gap-6 sm:grid-cols-2">
          <AnimateInView delay={200}>
            <a
              href="https://github.com/whitexie/ant-chat/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 transition-all hover:border-accent/50 hover:shadow-lg"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-foreground transition-colors group-hover:bg-accent/10">
                <Apple className="h-8 w-8" />
              </div>
              <div>
                <h3 className="mb-1 text-lg font-semibold">macOS</h3>
                <p className="text-sm text-muted-foreground">
                  支持 Intel / Apple Silicon
                </p>
                <p className="text-sm text-muted-foreground">macOS 10.15+</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
                下载
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </a>
          </AnimateInView>

          <AnimateInView delay={300}>
            <a
              href="https://github.com/whitexie/ant-chat/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 transition-all hover:border-accent/50 hover:shadow-lg"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-foreground transition-colors group-hover:bg-accent/10">
                <Monitor className="h-8 w-8" />
              </div>
              <div>
                <h3 className="mb-1 text-lg font-semibold">Windows</h3>
                <p className="text-sm text-muted-foreground">x64 架构</p>
                <p className="text-sm text-muted-foreground">Windows 10+</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
                下载
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </a>
          </AnimateInView>
        </div>

        <AnimateInView delay={400}>
          <p className="text-sm text-muted-foreground">
            所有版本均可在
            {' '}
            <a
              href="https://github.com/whitexie/ant-chat/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-4 hover:text-accent/80"
            >
              GitHub Releases
            </a>
            {' '}
            页面获取
          </p>
        </AnimateInView>
      </div>
    </section>
  )
}
