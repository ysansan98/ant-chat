import type { WorkspaceTreeEntry } from '@ant-chat/shared'
import type { FileTabView } from './FileContentArea'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FileContentArea } from './FileContentArea'

// CodeBlock mock：避免 shiki 初始化
vi.mock('@workspace/ui/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre data-testid="mock-code-block">{code}</pre>,
}))

// MarkdownPreview mock：避免 markdown 解析
vi.mock('./MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown">{content}</div>
  ),
}))

// 预览组件 mock：避免加载 WASM / 初始化第三方库
vi.mock('./previews/ImagePreview', () => ({
  ImagePreview: ({ url, fileName }: { url: string, fileName: string }) => (
    <div data-testid="image-preview"><img src={url} alt={fileName} /></div>
  ),
}))
vi.mock('./previews/AudioPreview', () => ({
  AudioPreview: ({ url, fileName }: { url: string, fileName: string }) => (
    <div data-testid="audio-preview">
      <audio data-testid="audio-player" src={url} />
      <span>{fileName}</span>
    </div>
  ),
}))
vi.mock('./previews/VideoPreview', () => ({
  VideoPreview: ({ url, fileName }: { url: string, fileName: string }) => (
    <div data-testid="video-preview">
      <video data-testid="video-player" src={url} />
      <span>{fileName}</span>
    </div>
  ),
}))
vi.mock('./previews/ExcelPreview', () => ({
  ExcelPreview: ({ url, fileName }: { url: string, fileName: string }) => (
    <div data-testid="excel-preview">
      <span>{fileName}</span>
      <span>{url}</span>
    </div>
  ),
}))
vi.mock('./previews/PdfPreview', () => ({
  PdfPreview: ({ url, fileName }: { url: string, fileName: string }) => (
    <div data-testid="pdf-preview">
      <span>{fileName}</span>
      <span>{url}</span>
    </div>
  ),
}))
vi.mock('./previews/DocxPreview', () => ({
  DocxPreview: ({ url, fileName }: { url: string, fileName: string }) => (
    <div data-testid="docx-preview">
      <span>{fileName}</span>
      <span>{url}</span>
    </div>
  ),
}))

function makeFile(name: string, relPath = ''): WorkspaceTreeEntry {
  return { name, relPath: relPath || name, type: 'file' }
}

function makeView(file: WorkspaceTreeEntry, overrides: Partial<FileTabView> = {}): FileTabView {
  return {
    file,
    status: 'ready',
    mode: 'source',
    ...overrides,
  }
}

describe('fileContentArea 文件类型分发', () => {
  beforeAll(() => {
    if (!globalThis.URL.createObjectURL) {
      globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
    }
  })

  it('图片文件分发到 ImagePreview', () => {
    const file = makeFile('photo.png')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { url: 'https://example.com/photo.png' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('image-preview')).toBeInTheDocument()
    expect(screen.getByAltText('photo.png')).toHaveAttribute('src', 'https://example.com/photo.png')
  })

  it('音频文件分发到 AudioPreview', () => {
    const file = makeFile('song.mp3')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { url: 'https://example.com/song.mp3' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('audio-preview')).toBeInTheDocument()
    expect(screen.getByTestId('audio-player')).toHaveAttribute('src', 'https://example.com/song.mp3')
  })

  it('视频文件分发到 VideoPreview', () => {
    const file = makeFile('clip.mp4')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { url: 'https://example.com/clip.mp4' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('video-preview')).toBeInTheDocument()
    expect(screen.getByTestId('video-player')).toHaveAttribute('src', 'https://example.com/clip.mp4')
  })

  it('excel 文件分发到 ExcelPreview', () => {
    const file = makeFile('data.xlsx')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { url: 'https://example.com/data.xlsx' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('excel-preview')).toBeInTheDocument()
  })

  it('pdf 文件分发到 PdfPreview', () => {
    const file = makeFile('document.pdf')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { url: 'https://example.com/document.pdf' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument()
  })

  it('docx 文件分发到 DocxPreview', () => {
    const file = makeFile('report.docx')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { url: 'https://example.com/report.docx' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('docx-preview')).toBeInTheDocument()
  })

  it('文本文件分发到 CodeBlock', () => {
    const file = makeFile('hello.txt')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { content: { content: 'hello world', size: 11 } })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('mock-code-block')).toHaveTextContent('hello world')
  })

  it('markdown preview 模式分发到 MarkdownPreview', () => {
    const file = makeFile('README.md')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { mode: 'preview', content: { content: '# 标题', size: 4 } })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('# 标题')
  })

  it('markdown source 模式分发到 CodeBlock', () => {
    const file = makeFile('README.md')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { mode: 'source', content: { content: '# 标题', size: 4 } })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('mock-code-block')).toBeInTheDocument()
  })

  it('错误状态展示错误信息', () => {
    const file = makeFile('broken.png')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { status: 'error', error: '文件损坏' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('file-preview-error')).toHaveTextContent('文件损坏')
  })

  it('加载状态展示 Spinner', () => {
    const file = makeFile('loading.png')
    render(
      <FileContentArea
        file={file}
        view={makeView(file, { status: 'loading' })}
        workspaceName="ws"
        onNavigateDir={() => {}}
        onModeChange={() => {}}
        hideHeader
      />,
    )
    expect(screen.getByTestId('file-preview-loading')).toBeInTheDocument()
  })
})
