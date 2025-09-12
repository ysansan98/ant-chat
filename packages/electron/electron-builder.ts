/* eslint-disable no-template-curly-in-string */
import type { Configuration } from 'electron-builder'

/**
 * electron-builder 配置
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration
 */
const config: Configuration = {
  appId: 'com.ant-chat.app',
  productName: 'Ant Chat',
  asar: true,
  directories: {
    output: 'release/${version}',
  },
  files: [
    'out/**/*',
    'migrations/**/*',
  ],
  extraResources: [
    { from: 'out/web/dist', to: 'out/web/dist' },
  ],
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
  },
  // GitHub 发布配置
  publish: [
    {
      provider: 'github',
      owner: 'whitexie',
      repo: 'ant-chat',
      private: false,
      releaseType: 'draft', // 或 'draft' 用于草稿发布
      // 更新日志配置 - 使用 changelog 生成器
      // 注意：electron-builder 会自动使用 git commit 信息作为更新日志
      // 如果需要自定义更新日志，可以使用 afterSign hook 来修改 release notes
    },
  ],
  mac: {
    icon: 'app-icons/mac/logo-mac.icns',
    category: 'public.app-category.productivity',
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'], // 支持 Intel 和 Apple Silicon
      },
      {
        target: 'zip', // 自动更新需要 zip 格式
        arch: ['x64', 'arm64'],
      },
    ],
    // 代码签名配置
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // 公证配置（如果需要）
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
        target: 'zip', // 自动更新需要 zip 格式
        arch: ['x64'],
      },
    ],
    artifactName: '${productName}_${version}.${ext}',
    requestedExecutionLevel: 'asInvoker',
    // 代码签名配置
    verifyUpdateCodeSignature: true,
    // 签名配置通过环境变量设置：
    // WIN_CSC_LINK - 证书文件路径
    // WIN_CSC_KEY_PASSWORD - 证书密码
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: true,
    createDesktopShortcut: true, // 创建桌面快捷方式
    createStartMenuShortcut: true, // 创建开始菜单快捷方式
    shortcutName: 'Ant Chat', // 快捷方式名称
    // 安装程序语言配置
    installerLanguages: ['zh_CN', 'en_US'],
  },
  // 自动更新配置
  afterSign: 'tsx ../../scripts/update-release-notes.ts', // 签名后更新更新日志
  // 生成自动更新所需的元数据文件
  generateUpdatesFilesForAllChannels: true,
}

export default config
