/* eslint-disable no-template-curly-in-string */
export default {
  // 调试模式
  // dryRun: true,
  // 这里改成你自己的仓库地址
  repositoryUrl: 'https://github.com/whitexie/ant-chat.git',
  branches: ['main'], // 指定在哪个分支下要执行发布操作

  // 分析提交记录
  analyzeCommits: {
    preset: 'conventionalcommits',
    releaseRules: [
      { type: 'feat', release: 'minor' },
      { type: 'fix', release: 'patch' },
      { type: 'perf', release: 'patch' },
      { type: 'refactor', release: 'patch' },
      { type: 'chore', release: 'patch' },
    ],
  },

  plugins: [
    // 1. 解析 commit 信息，默认就是 Angular 规范
    '@semantic-release/commit-analyzer',
    // 2. 生成发布信息
    '@semantic-release/release-notes-generator',
    // 3. 把发布日志写入该文件
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
      },
    ],
    // 4. 使用自定义脚本更新所有 package.json 中的版本号
    [
      '@semantic-release/exec',
      {
        preparecmd: 'pnpm -r version ${nextRelease.version} --no-git-tag-version',
      },
    ],
    // 5. 将变更推送回 Git（版本号和 changelog）
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'apps/desktop/package.json', 'packages/mcp-client-hub/package.json', 'packages/shared/package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    // 6. 上传构建产物到 GitHub Releases
    [
      '@semantic-release/github',
      {
        assets: [
          'apps/desktop/release/**/*.exe',
          'apps/desktop/release/**/*.blockmap',
          'apps/desktop/release/**/*.dmg',
          'apps/desktop/release/**/*.zip',
          'apps/desktop/release/**/*.yml',
        ],
      },
    ],
  ],
}
