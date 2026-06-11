/* eslint-disable no-template-curly-in-string */
import type { Configuration } from 'electron-builder'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const keepLanguages = new Set(['en', 'en_GB', 'en-US', 'en_US'])
const require = createRequire(import.meta.url)
const agentBrowserPackageRoot = path.dirname(require.resolve('agent-browser/package.json'))

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration
 */
const config: Configuration = {
  appId: 'com.ant-chat.app',
  productName: 'Ant Chat',
  asar: true,
  asarUnpack: [
    '**/*.node', // 所有原生模块都解压出来
  ],
  extraResources: [
    {
      from: 'node_modules/better-sqlite3/build/Release/',
      to: 'better-sqlite3',
      filter: ['*.node'], // 只复制原生模块
    },
    {
      from: 'resources/rg',
      to: 'rg',
    },
  ],
  afterPack: async (context) => {
    const arch = getBuilderArch(context.arch)
    const sourceName = getAgentBrowserBinaryName(context.electronPlatformName, arch)
    const executableName = context.electronPlatformName === 'win32' ? 'agent-browser.exe' : 'agent-browser'
    const resourcesPath = ['darwin', 'mas'].includes(context.electronPlatformName)
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents/Resources',
        )
      : path.join(context.appOutDir, 'resources')
    const targetDir = path.join(resourcesPath, 'agent-browser')
    const targetPath = path.join(targetDir, executableName)
    await fs.mkdir(targetDir, { recursive: true })
    await fs.copyFile(path.join(agentBrowserPackageRoot, 'bin', sourceName), targetPath)
    if (context.electronPlatformName !== 'win32') {
      await fs.chmod(targetPath, 0o755)
    }

    if (!['darwin', 'mas'].includes(context.electronPlatformName))
      return

    const frameworkResourcePath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources',
    )

    try {
      const entries = await fs.readdir(frameworkResourcePath)
      await Promise.all(
        entries.map(async (file) => {
          if (!file.endsWith('.lproj'))
            return
          const lang = file.split('.')[0]
          if (keepLanguages.has(lang))
            return
          await fs.rm(path.join(frameworkResourcePath, file), { force: true, recursive: true })
        }),
      )
    }
    catch {
      // Non-critical: folder may not exist
    }
  },
  directories: {
    output: 'release/${version}',
  },
  files: [
    'out/**/*',
    '!node_modules/**',
    'node_modules/better-sqlite3',

    'node_modules/electron-store',
    'node_modules/electron-updater',
    'node_modules/undici',

    '!**/*.map', // 排除所有 .map 文件
    '!**/node_modules/better-sqlite3/deps/**', // 排除 better-sqlite3 的 C 源码

    //
    '!**/node_modules/**/*.cpp',
    '!**/node_modules/node-addon-api/**',
    '!**/node_modules/prebuild-install/**',
    '!scripts',
    '!local',
    '!docs',
    '!packages',
    '!.swc',
    '!.bin',
    '!._*',
    '!*.log',
    '!stats.html',
    '!*.md',
    '!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}',
    '!**/{test,tests,__tests__,powered-test,coverage}/**',
    '!**/*.{map,ts,tsx,jsx,less,scss,sass,css.d.ts,d.cts,d.mts,md,markdown,yaml,yml}',
    '!**/{example,examples}/**',
    '!**/*.{spec,test}.{js,jsx,ts,tsx}',
    '!**/*.min.*.map',
    '!**/*.d.ts',
    '!**/dist/es6/**',
    '!**/dist/demo/**',
    '!**/amd/**',
    '!**/{.DS_Store,Thumbs.db,thumbs.db,__pycache__}',
    '!**/{LICENSE,license,LICENSE.*,*.LICENSE.txt,NOTICE.txt,README.md,readme.md,CHANGELOG.md}',
  ],
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
  },
  publish: [
    {
      provider: 'github',
      owner: 'whitexie',
      repo: 'ant-chat',
      private: false,
      releaseType: 'release',
    },
  ],
  mac: {
    icon: 'app-icons/mac/logo-mac.icns',
    category: 'public.app-category.productivity',
    target: [
      {
        target: 'dmg',
        // arch: ['x64', 'arm64'],
        arch: ['arm64'],
      },
      {
        target: 'zip',
        // arch: ['x64', 'arm64'],
        arch: ['arm64'],
      },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: false,
  },
  dmg: {
    contents: [
      {
        x: 410,
        y: 150,
        type: 'link',
        path: '/Applications',
      },
      {
        x: 130,
        y: 150,
        type: 'file',
      },
    ],
  },
  win: {
    icon: 'app-icons/win/logo-win.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'zip',
        arch: ['x64'],
      },
    ],
    artifactName: '${productName}_${version}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Ant Chat',
    installerLanguages: ['zh_CN', 'en_US'],
  },
  generateUpdatesFilesForAllChannels: true,
}

function getBuilderArch(arch: number): 'x64' | 'arm64' {
  // builder-util Arch enum: x64=1, arm64=3.
  if (arch === 1)
    return 'x64'
  if (arch === 3)
    return 'arm64'
  throw new Error(`Unsupported agent-browser build architecture: ${arch}`)
}

function getAgentBrowserBinaryName(platform: string, arch: 'x64' | 'arm64'): string {
  if ((platform === 'darwin' || platform === 'mas') && (arch === 'x64' || arch === 'arm64'))
    return `agent-browser-darwin-${arch}`
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64'))
    return `agent-browser-linux-${arch}`
  if (platform === 'win32' && arch === 'x64')
    return 'agent-browser-win32-x64.exe'
  throw new Error(`Unsupported agent-browser build target: ${platform}-${arch}`)
}

export default config
