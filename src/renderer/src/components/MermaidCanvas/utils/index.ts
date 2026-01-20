import { toBase64 } from 'js-base64'

const FONT_AWESOME_URL = `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css`

export function getBase64SVG(svg: HTMLElement, width?: number, height?: number): string {
  if (svg) {
    svg = svg.cloneNode(true) as HTMLElement
  }

  height && svg.setAttribute('height', `${height}px`)
  width && svg.setAttribute('width', `${width}px`)

  const svgString = svg.outerHTML
    .replace(/<br>/g, '<br/>')
    .replace(/<img([^>]*)>/g, (_, g: string) => `<img ${g} />`)

  return toBase64(`<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet href="${FONT_AWESOME_URL}" type="text/css"?>
${svgString}`)
}

export function simulateDownload(download: string, href: string): void {
  const a = document.createElement('a')
  a.download = download
  a.href = href
  a.click()
  a.remove()
}

export function getSvgSize(svgElement: SVGElement) {
  const viewBox = svgElement.getAttribute('viewBox')

  if (viewBox) {
    const [, , width, height] = viewBox.split(' ').map(Number)
    return {
      width,
      height,
    }
  }

  const bbox = svgElement.getBoundingClientRect()
  return {
    width: bbox.width,
    height: bbox.height,
  }
}

export async function downloadSvgToPng(container: HTMLElement, bgColor: string = '#fff') {
  const canvas = document.createElement('canvas')
  const svg = container.querySelector('svg')
  if (!svg) {
    throw new Error('svg not found')
  }

  const bbox = getSvgSize(svg)
  canvas.width = bbox.width
  canvas.height = bbox.height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('context not found')
  }

  context.fillStyle = bgColor
  context.fillRect(0, 0, canvas.width, canvas.height)

  const image = new Image()
  image.onload = () => {
    const downloadImage: Exporter = (context, image) => {
      return () => {
        const { canvas } = context
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        simulateDownload(
          `${Date.now()}.png`,
          canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream'),
        )
      }
    }
    downloadImage(context, image)()
  }

  image.src = `data:image/svg+xml;base64,${getBase64SVG(svg as unknown as HTMLElement, canvas.width, canvas.height)}`
}

export type Exporter = (context: CanvasRenderingContext2D, image: HTMLImageElement) => () => void
