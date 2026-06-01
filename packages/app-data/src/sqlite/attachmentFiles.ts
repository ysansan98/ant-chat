import path from 'node:path'

export function getAttachmentFilePath(root: string, fileId: string): string {
  validateAttachmentFileId(fileId)
  return path.join(root, fileId.slice(0, 2), fileId)
}

export function getLegacyAttachmentFilePath(root: string, fileId: string): string {
  validateAttachmentFileId(fileId)
  return path.join(root, fileId)
}

export function getAttachmentFileCandidates(root: string, fileId: string): string[] {
  return [
    getAttachmentFilePath(root, fileId),
    getLegacyAttachmentFilePath(root, fileId),
  ]
}

function validateAttachmentFileId(fileId: string): void {
  if (!/^[\w-]+$/.test(fileId)) {
    throw new Error(`Invalid attachment file id: ${fileId}`)
  }
}
