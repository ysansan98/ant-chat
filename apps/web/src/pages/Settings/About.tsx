import { Button } from '@workspace/ui/components/button'
import { Card, CardContent } from '@workspace/ui/components/card'
import { AboutUpdateSettings } from '@/components/About/AboutUpdateSettings'
import { isElectronRuntime } from '@/utils/ipc-bus'
import { SettingsPageLayout } from './SettingsPageLayout'

export function About() {
  const handleOpenGitHub = () => {
    location.href = 'https://github.com/whitexie/ant-chat'
  }

  const handleOpenLicense = () => {
    location.href = 'https://github.com/whitexie/ant-chat/blob/main/LICENSE'
  }

  return (
    <SettingsPageLayout
      title="关于"
      description="查看应用信息、版本与更新设置。"
      variant="narrow"
    >
      <div className="flex flex-col gap-4">
        {/* 应用信息卡片 —— 内部居中是有意例外 */}
        <Card className="w-full">
          <CardContent className="space-y-3 text-center">
            <div className="flex justify-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-white p-2">
                <img src="./logo.svg" alt="logo" className="size-full" draggable={false} />
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-2xl/8 font-bold text-balance">Ant Chat</h2>
              <p className="text-sm text-muted-foreground">
                现代化的 AI 聊天桌面应用
              </p>
            </div>

            <p className="mx-auto max-w-md text-sm text-pretty text-muted-foreground">
              基于 Electron 和 Ant Design X 构建，支持多种 AI 提供商，
              提供丰富的聊天体验和 MCP 协议集成。
            </p>

            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                onClick={handleOpenGitHub}
              >

                <span className="icon-[mdi--github] size-4"></span>
                GitHub
              </Button>
              <Button
                variant="outline"
                onClick={handleOpenLicense}
              >
                <span className="icon-[clarity--balance-line] size-4"></span>
                开源协议
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 更新设置 */}
        {isElectronRuntime() && <AboutUpdateSettings />}
      </div>
    </SettingsPageLayout>
  )
}
