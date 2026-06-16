import AnimateInView from './AnimateInView'

const TECH_STACK = [
  {
    category: '核心框架',
    items: [
      { name: 'Electron', description: '跨平台桌面应用框架' },
      { name: 'React 19', description: '现代化前端框架' },
      { name: 'TypeScript', description: '类型安全的 JavaScript' },
      { name: 'Vite', description: '快速构建工具' },
    ],
  },
  {
    category: 'UI 组件',
    items: [
      { name: 'shadcn/ui', description: '可复用 UI 组件库' },
      { name: 'TailwindCSS', description: '原子化 CSS 框架' },
      { name: 'Kami 主题', description: 'Paper UI 设计风格' },
    ],
  },
  {
    category: 'AI 集成',
    items: [
      { name: 'Vercel AI SDK', description: '统一的 AI 模型调用接口' },
      { name: 'MCP 协议', description: 'Model Context Protocol' },
    ],
  },
  {
    category: '状态管理与存储',
    items: [
      { name: 'Zustand', description: '轻量级状态管理' },
      { name: 'Drizzle ORM', description: 'TypeScript 优先的 ORM' },
      { name: 'SQLite', description: '高性能嵌入式数据库' },
    ],
  },
]

export default function TechStack() {
  return (
    <section id="tech-stack" className="bg-secondary/30 px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <AnimateInView className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold md:text-4xl">技术栈</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            现代化技术选型，保证开发体验和运行性能
          </p>
        </AnimateInView>

        <div className="grid gap-8 md:grid-cols-2">
          {TECH_STACK.map((group, index) => (
            <AnimateInView key={group.category} delay={index * 150}>
              <div className="h-full rounded-xl border border-border bg-card p-6">
                <h3 className="mb-4 text-lg font-semibold">{group.category}</h3>
                <div className="space-y-3">
                  {group.items.map(item => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between rounded-lg bg-secondary/50 px-4 py-3"
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {item.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
