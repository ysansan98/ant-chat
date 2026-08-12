interface VideoPreviewProps {
  url: string
  fileName: string
}

/** 视频预览：原生 <video controls>，自适应容器大小，依赖 Range 支持进度拖动。 */
export function VideoPreview({ url, fileName }: VideoPreviewProps) {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-900/95 p-2" data-testid="video-preview">
      <video
        controls
        src={url}
        className="max-h-full max-w-full object-contain"
        data-testid="video-player"
        title={fileName}
      >
        您的浏览器不支持视频预览
      </video>
    </div>
  )
}
