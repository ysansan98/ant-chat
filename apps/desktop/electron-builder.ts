/* eslint-disable no-template-curly-in-string */
import type { AfterPackContext, Configuration } from 'electron-builder'
import fs from 'node:fs/promises'
import path from 'node:path'

const keepLanguages = new Set(['en', 'en_GB', 'en-US', 'en_US'])

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
      from: 'resources/ant-chat',
      to: 'ant-chat',
    },
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
    await writeCliLaunchers(context)

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
    'out/main/builtin-skills/**/*.md',
  ],
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
  },
  publish: [
    {
      provider: 'github',
      owner: 'ysansan98',
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
        arch: ['x64', 'arm64'],
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64'],
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

async function writeCliLaunchers(context: AfterPackContext): Promise<void> {
  const resourcesPath = ['darwin', 'mas'].includes(context.electronPlatformName)
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
    : path.join(context.appOutDir, 'resources')
  const launcherDir = path.join(resourcesPath, 'ant-chat')
  await fs.mkdir(launcherDir, { recursive: true })

  if (['darwin', 'mas'].includes(context.electronPlatformName)) {
    const executable = path.join('..', '..', 'MacOS', context.packager.appInfo.productFilename)
    await fs.writeFile(path.join(launcherDir, 'ant-chat'), `#!/bin/sh\nexec "$(dirname "$0")/${executable}" --ant-chat-cli "$@"\n`, { mode: 0o755 })
    await fs.chmod(path.join(launcherDir, 'ant-chat'), 0o755)
    return
  }

  const executable = `%~dp0..\\..\\${context.packager.appInfo.productFilename}.exe`
  await fs.writeFile(path.join(launcherDir, 'ant-chat.cmd'), `@echo off\n"${executable}" --ant-chat-cli %*\n`)
}

export default config
