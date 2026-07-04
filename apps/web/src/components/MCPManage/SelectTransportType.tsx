import { Cable, Check, CheckCircle, Terminal } from 'lucide-react'

interface SelectTransportTypeProps {
  value?: 'stdio' | 'sse'
  onChange?: (e: string) => void
}

const options = [
  { id: 'sse', icon: <Cable className="size-5" />, name: 'Streamable HTTP', descript: '基于流式 HTTP 的通信协议', features: ['连接远程MCP服务器，无需额外安装配置'] },
  { id: 'stdio', icon: <Terminal className="size-5" />, name: 'STDIO', descript: '基于标准输入输出的通信协议', features: ['更低的通信延迟，适合本地执行', '需要在本地安装运行MCP服务器'] },
]

export function SelectTransportType({ value, onChange }: SelectTransportTypeProps) {
  return (
    <div className="flex justify-around">
      {
        options.map(item => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            className={`
              relative w-[48%] rounded-xl border border-solid p-3 transition-colors
              ${value === item.id ? 'border-primary' : 'border-(--border-color)'}
              cursor-pointer
              hover:border-primary
            `}
            onClick={() => {
              onChange?.(item.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onChange?.(item.id)
              }
            }}
          >
            <div className="flex gap-2 text-xl">
              <div className="items-start">
                {item.icon}
              </div>
              <div className="text-base font-bold">
                <div>{item.name}</div>
                <div className={`
                  mt-0.5 text-xs font-normal text-muted-foreground
                `}
                >
                  {item.descript}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-3 pl-1">
              {
                item.features.map(t => (
                  <div key={t} className="flex items-center gap-2 text-xs">
                    <span className="text-green-500">
                      <Check className="size-4" />
                    </span>
                    {t}
                  </div>
                ))
              }
            </div>
            {
              value === item.id
              && (
                <span className="text-primary">
                  <CheckCircle className="absolute top-2 right-2" />
                </span>
              )
            }
          </div>
        ))
      }
    </div>
  )
}
