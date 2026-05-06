import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription } from '@workspace/ui/components/card'
import { GitBranch, Heart, Info } from 'lucide-react'
import { AboutUpdateSettings } from '@/components/About/AboutUpdateSettings'

export function About() {
  const handleOpenGitHub = () => {
    location.href = 'https://github.com/whitexie/ant-chat'
  }

  const handleOpenLicense = () => {
    location.href = 'https://github.com/whitexie/ant-chat/blob/main/LICENSE'
  }

  return (
    <div className="flex flex-col gap-4 space-y-3 p-4">
      {/* 应用信息卡片 */}
      <Card className="w-full">
        <CardContent className="space-y-3 text-center">
          <div className="flex justify-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-white p-2">
              <img src="./logo.svg" alt="logo" className="size-full" draggable={false} />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-2xl font-bold">Ant Chat</h2>
            <p className="text-sm text-muted-foreground">
              现代化的 AI 聊天桌面应用
            </p>
          </div>

          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            基于 Electron 和 Ant Design X 构建，支持多种 AI 提供商，
            提供丰富的聊天体验和 MCP 协议集成。
          </p>

          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={handleOpenGitHub}
            >
              <GitBranch />
              GitHub
            </Button>
            <Button
              variant="outline"
              onClick={handleOpenLicense}
            >
              <Info />
              开源协议
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 更新设置 */}
      <AboutUpdateSettings />

      {/* 致谢信息 */}
      <Card className="w-full">
        <CardContent className="space-y-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <Heart className="size-4 text-red-500" />
            <CardDescription className="font-semibold text-foreground!">致谢</CardDescription>
          </div>

          <p className="text-sm text-muted-foreground">
            感谢所有为开源社区做出贡献的开发者们，
            以及 Ant Design、Electron、React 等优秀项目的支持。
          </p>

          <CardDescription>© 2025 Ant Chat. All rights reserved.</CardDescription>
        </CardContent>
      </Card>
    </div>
  )
}
