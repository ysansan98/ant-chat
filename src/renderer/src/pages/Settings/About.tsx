import { GithubOutlined, HeartOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { Button, Card, Space, Typography } from 'antd'
import { AboutUpdateSettings } from '@/components/About/AboutUpdateSettings'

const { Title, Text, Paragraph } = Typography

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
        <div className="space-y-3 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2">
              <img src="./logo.svg" alt="logo" className="h-full w-full" draggable={false} />
            </div>
          </div>

          <div>
            <Title level={2} className="!mb-2">Ant Chat</Title>
            <Text type="secondary" className="text-base">
              现代化的 AI 聊天桌面应用
            </Text>
          </div>

          <Paragraph type="secondary" className="mx-auto max-w-md">
            基于 Electron 和 Ant Design X 构建，支持多种 AI 提供商，
            提供丰富的聊天体验和 MCP 协议集成。
          </Paragraph>

          <Space size="middle">
            <Button
              icon={<GithubOutlined />}
              onClick={handleOpenGitHub}
            >
              GitHub
            </Button>
            <Button
              icon={<InfoCircleOutlined />}
              onClick={handleOpenLicense}
            >
              开源协议
            </Button>
          </Space>
        </div>
      </Card>

      {/* 更新设置 */}
      <AboutUpdateSettings />

      {/* 致谢信息 */}
      <Card size="small" className="w-full">
        <div className="space-y-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <HeartOutlined className="text-red-500" />
            <Text strong>致谢</Text>
          </div>

          <Paragraph type="secondary" className="text-sm">
            感谢所有为开源社区做出贡献的开发者们，
            以及 Ant Design、Electron、React 等优秀项目的支持。
          </Paragraph>

          <Text type="secondary" className="text-xs">
            © 2025 Ant Chat. All rights reserved.
          </Text>
        </div>
      </Card>
    </div>
  )
}
