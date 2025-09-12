import type { AntChatFileStructure } from '@/constants'
import { pick } from 'lodash-es'
import { ANT_CHAT_FILE_TYPE, ANT_CHAT_STRUCTURE } from '@/constants'

export async function downloadAntChatFile(fileContent: string, fileName: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([fileContent]))
  a.download = fileName
  a.click()
  a.remove()
}

export async function exportAntChatFile(fileContent: string, fileName: string) {
  const fileHandle = await window.showSaveFilePicker({ suggestedName: fileName, types: [ANT_CHAT_FILE_TYPE] })
  const writableStream = await fileHandle.createWritable()
  await writableStream.write(fileContent)
  await writableStream.close()
}

export async function importAntChatFile(): Promise<AntChatFileStructure> {
  const fileHandle = await showOpenFilePicker({
    types: [ANT_CHAT_FILE_TYPE],
  })
  const file = await fileHandle[0].getFile()
  if (!file.name.endsWith('.antchat')) {
    throw new Error('文件格式错误')
  }
  const text = await file.text()
  try {
    return parseAntFile(text)
  }
  catch {
    throw new Error('antchat文件解析失败～')
  }
}

function parseAntFile(text: string): AntChatFileStructure {
  const data: AntChatFileStructure = Object.assign({}, ANT_CHAT_STRUCTURE, pick(JSON.parse(text), Object.keys(ANT_CHAT_STRUCTURE)))
  const { type, version, conversations } = data
  if (type !== 'Ant Chat' || version !== '1' || !Array.isArray(conversations)) {
    throw new Error('antchat文件解析失败～')
  }
  return data
}

/**
 * 将 File 对象转换为 Base64 字符串
 * @param file 要转换的 File 对象
 * @returns 返回一个 Promise，解析为 Base64 字符串
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // 添加文件类型校验
    if (!(file instanceof Blob)) {
      reject(new Error('无效的文件对象'))
      return
    }

    const reader = new FileReader()

    // 当文件读取成功时，调用 resolve 并传递 Base64 数据
    reader.onload = (event) => {
      if (event.target && typeof event.target.result === 'string') {
        resolve(event.target.result)
      }
      else {
        reject(new Error('无法读取文件数据'))
      }
    }

    // 如果读取过程中发生错误，调用 reject
    reader.onerror = () => {
      reject(new Error('文件读取失败'))
    }

    // 以 Data URL 的形式读取文件，结果会以 Base64 编码
    reader.readAsDataURL(file)
  })
}

export function isImageMIME(mime: string) {
  return mime.startsWith('image/')
}
