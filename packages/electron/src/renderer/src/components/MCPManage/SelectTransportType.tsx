import { ApiOutlined, CheckCircleFilled, CheckOutlined, CiCircleOutlined } from '@ant-design/icons'

interface SelectTransportTypeProps {
  value?: 'stdio' | 'sse'
  onChange?: (e: string) => void
}

const options = [
  { id: 'sse', icon: <ApiOutlined />, name: 'Streamable HTTP', descript: '基于流式 HTTP 的通信协议', features: ['连接远程MCP服务器，无需额外安装配置'] },
  { id: 'stdio', icon: <CiCircleOutlined />, name: 'STDIO', descript: '基于标准输入输出的通信协议', features: ['更低的通信延迟，适合本地执行', '需要在本地安装运行MCP服务器'] },
]

export function SelectTransportType({ value, onChange }: SelectTransportTypeProps) {
  return (
    <div className="flex justify-around">
      {
        options.map(item => (
          <div
            key={item.id}
            className={`
              antd-css-var relative w-[48%] rounded-xl border-1 border-solid p-3
              ${value === item.id ? 'border-(--ant-color-primary-text)' : 'border-(--border-color)'}
              cursor-pointer
              hover:border-(--ant-color-primary-text)
            `}
            onClick={() => {
              onChange?.(item.id)
            }}
          >
            <div className="flex gap-2 text-xl">
              <div className="items-start">
                {item.icon}
              </div>
              <div className="text-base font-bold">
                <div>{item.name}</div>
                <div className={`
                  mt-0.5 text-xs font-normal text-black/30
                  dark:text-white/30
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
                    <span className="text-(--ant-color-success)">

                      <CheckOutlined />
                    </span>
                    {t}
                  </div>
                ))
              }
            </div>
            {
              value === item.id
              && (
                <span className="text-(--ant-color-primary)">
                  <CheckCircleFilled className="absolute top-2 right-2 text-xl" />
                </span>
              )
            }

          </div>
        ))
      }
    </div>
  )
}
