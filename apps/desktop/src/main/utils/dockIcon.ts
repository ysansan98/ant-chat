import path from 'node:path'
import process from 'node:process'
import { app, nativeTheme } from 'electron'

/**
 * 设置 macOS Dock 图标，使深色模式下切换到深色变体。
 *
 * .icns 格式不支持深色外观变体（深色图标只能走 Xcode 资源目录方案），
 * 因此 Finder/启动台使用包内静态的默认图标，Dock 图标跟随系统外观实时切换。
 * 设置失败不阻断主流程：Dock 图标属于非关键表现层。
 */
export function setupDockIcon(): void {
  if (process.platform !== 'darwin')
    return

  const iconsDir = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '../../app-icons/mac')
  const defaultIcon = path.join(iconsDir, 'icon-macos-default.png')
  const darkIcon = path.join(iconsDir, 'icon-macos-dark.png')

  const apply = (): void => {
    try {
      app.dock?.setIcon(nativeTheme.shouldUseDarkColors ? darkIcon : defaultIcon)
    }
    catch {
      // 非致命：Dock 图标设置失败不影响应用主流程
    }
  }

  nativeTheme.on('updated', apply)
  apply()
}
