import { Heart, SquareTerminal } from 'lucide-react'
import AnimateInView from './AnimateInView'

interface FooterLink {
  label: string
  href: string
  external?: boolean
}

const LINKS: { title: string, items: FooterLink[] }[] = [
  {
    title: '项目',
    items: [
      { label: '功能特性', href: '#features' },
      { label: '技术栈', href: '#tech-stack' },
      { label: '下载', href: '#download' },
    ],
  },
  {
    title: '社区',
    items: [
      { label: 'GitHub', href: 'https://github.com/whitexie/ant-chat', external: true },
      { label: 'Issues', href: 'https://github.com/whitexie/ant-chat/issues', external: true },
      { label: 'Discussions', href: 'https://github.com/whitexie/ant-chat/discussions', external: true },
    ],
  },
  {
    title: '开发',
    items: [
      { label: 'Fork 仓库', href: 'https://github.com/whitexie/ant-chat/fork', external: true },
      { label: 'Pull Requests', href: 'https://github.com/whitexie/ant-chat/pulls', external: true },
      { label: 'CI/CD', href: 'https://github.com/whitexie/ant-chat/actions', external: true },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="border-t border-border bg-secondary/30 px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <AnimateInView>
          <div className="mb-12 grid gap-8 md:grid-cols-4">
            <div>
              <a href="#" className="mb-4 flex items-center gap-2">
                <img src="/logo.svg" alt="Ant Chat" className="h-8 w-8" />
                <span className="text-lg font-bold">Ant Chat</span>
              </a>
              <p className="text-sm text-muted-foreground">
                通用 AI Agent，支持多模型、工具调用、MCP 协议和技能扩展
              </p>
            </div>

            {LINKS.map(group => (
              <div key={group.title}>
                <h4 className="mb-4 text-sm font-semibold">{group.title}</h4>
                <ul className="space-y-2">
                  {group.items.map(item => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        target={item.external ? '_blank' : undefined}
                        rel={item.external ? 'noopener noreferrer' : undefined}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </AnimateInView>

        <AnimateInView delay={200}>
          <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              Made with
              {' '}
              <Heart className="h-3.5 w-3.5 text-red-500" />
              {' '}
              by 幺叁叁
            </p>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">MIT License</span>
              <a
                href="https://github.com/whitexie/ant-chat"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <SquareTerminal className="h-4 w-4" />
                GitHub
              </a>
            </div>
          </div>
        </AnimateInView>
      </div>
    </footer>
  )
}
