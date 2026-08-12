import { FileAudioIcon } from 'lucide-react'

interface AudioPreviewProps {
  url: string
  fileName: string
}

/** 音频预览：原生 <audio controls>，带文件名信息行。 */
export function AudioPreview({ url, fileName }: AudioPreviewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6" data-testid="audio-preview">
      <div className="flex flex-col items-center gap-3">
        <FileAudioIcon className="size-10 text-muted-foreground" />
        <span className="max-w-md truncate text-sm text-foreground/85" title={fileName}>{fileName}</span>
      </div>
      <audio controls src={url} className="w-full max-w-md" data-testid="audio-player">
        您的浏览器不支持音频预览
      </audio>
    </div>
  )
}
