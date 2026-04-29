import type { AgentProgressItem } from '@ant-chat/shared'

export default function AgentProgressList({ progress }: { progress: AgentProgressItem[] }) {
  if (!progress.length) {
    return null
  }

  return (
    <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
      {progress.map(item => (
        <div key={item.id} className="flex items-center justify-between py-0.5">
          <span>{item.title}</span>
          <span className="text-gray-500">{item.status}</span>
        </div>
      ))}
    </div>
  )
}
