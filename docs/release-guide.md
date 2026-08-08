# Ant Chat 版本与发布指南

本文说明两个问题：

1. 当前 commit 是否需要进入 changelog；
2. 如何从 changeset 生成版本、创建 tag，并完成 Desktop/npm 发布。

本文以当前仓库的 Changesets、CI 和发布 workflow 为准。commit message 不是唯一判断依据，真正的判断标准是：这次变更是否改变了用户可见行为，以及它属于哪个发行物。

## 1. 先判断当前变更是否需要 changelog

### 1.1 需要 changelog 的变更

满足以下任一条件，就应新增 changeset：

- 用户能看到或感知到的功能、行为、性能、兼容性或安全变化；
- npm 产品包 `ant-chat` 的启动参数、CLI、Web UI、RPC、SSE 或运行时行为变化；
- Desktop 的窗口、系统集成、安装包、更新、权限或内置 Skill 行为变化；
- `packages/backend`、`packages/shared`、`packages/control-client`、`packages/ui` 或 `apps/web` 的共享代码变化，且影响 npm 产品或 Desktop；
- 修复会改变用户实际遇到的错误、数据处理或运行结果；
- 依赖升级改变了运行时、安装方式、平台兼容性或发布产物。

### 1.2 通常不需要 changelog 的变更

以下变更通常可以不新增 changeset：

- 只修改 `docs/`、`prototypes/` 或研究材料；
- 只修改根 README 或 `.github` CI/workflow 配置，且不改变用户产品行为；
- 只修改测试、类型、内部重命名或开发环境辅助代码，且没有用户可见影响；
- 只更新锁文件，且没有依赖行为变化。

“通常”不是豁免。若内部改动会进入用户安装包、改变 CLI、改变默认行为或影响升级兼容性，仍然需要 changeset。

### 1.3 如何判断发行物

| 变更范围 | changeset 选择 | 说明 |
| --- | --- | --- |
| 只影响 npm 产品包 | `ant-chat` | 例如 npm CLI、产品服务、npm tarball 内容 |
| 只影响 Desktop | `@ant-chat/desktop` | 例如 Electron 主进程、安装包、更新逻辑 |
| 共享 backend、shared、control-client、Web UI 或控制协议 | 通常同时选择 `ant-chat` 和 `@ant-chat/desktop` | 两个发行物都可能受影响；如果确认只影响一端，必须在 PR 描述中说明 |
| 只影响内部测试或文档 | 不选发行物 | 不产生用户 changelog |

`@ant-chat/backend`、`@ant-chat/shared` 和 `@ant-chat/control-client` 是内部实现包，不作为独立 npm 发行物发布。

## 2. 为 commit 创建 changeset

在包含当前变更的分支执行：

```bash
pnpm changeset
```

交互选择规则：

1. 选择真正受影响的发行物；
2. 选择版本级别：
   - `patch`：向后兼容的 bug 修复；
   - `minor`：向后兼容的新功能；
   - `major`：破坏性行为或 API 变化；
3. 用中文写面向用户的说明，不写内部实现细节；
4. 检查生成的 `.changeset/*.md`。

示例：

```md
---
"ant-chat": minor
"@ant-chat/desktop": minor
---

统一 npm 产品包与 Desktop 的运行时控制入口，并修复内置 Skill 在生产环境中的 CLI 分发。
```

只增加 commit message 中的 `feat:` 或 `fix:` 不等于创建了 changelog。CI 检查的是 changeset 文件，不是 commit 类型。

## 3. PR 阶段检查

提交 PR 前至少执行：

```bash
pnpm check
pnpm build
node scripts/validate-changeset.mjs origin/main
git diff --check
```

CI 在 PR 上会执行 Node.js 22 的 changeset 覆盖检查和 `pnpm check`：[ci.yml](/Users/ysansan/webProject/ant-chat/.github/workflows/ci.yml:35)。

`scripts/validate-changeset.mjs` 会：

- 检查用户可见代码变更是否存在 changeset；
- 对共享目录只选择一个发行物的情况给出警告；
- 忽略文档、原型、根 README、`.github` 和锁文件等非产品变更。

警告需要人工判断，不能机械地把两个发行物都加上。真正只影响一端时，在 PR 描述中写清楚原因。

## 4. 生成版本和 changelog

合并 PR 后，维护者在版本准备分支执行：

```bash
pnpm version-packages
pnpm install --lockfile-only
pnpm check
git diff --check
```

Changesets 会消费 `.changeset/*.md`，更新：

- `packages/ant-chat/package.json` 和 `packages/ant-chat/CHANGELOG.md`；
- `apps/desktop/package.json` 和 `apps/desktop/CHANGELOG.md`；
- 相关内部 workspace 版本与 lockfile。

检查版本结果：

```bash
node -p "require('./packages/ant-chat/package.json').version"
node -p "require('./apps/desktop/package.json').version"
```

两个发行物独立版本，不要求相同。不要在发布 workflow 中手动修改版本或 changelog；版本变更应通过 Changesets 版本 PR 合入。

## 5. 创建发布 tag

先确认版本 PR 已合并，并确认工作区干净：

```bash
git status --short
git pull --ff-only
```

### 5.1 Desktop

tag 必须匹配 `apps/desktop/package.json`：

```bash
git tag v<Desktop版本>
git push origin v<Desktop版本>
```

例如：

```bash
git tag v1.0.0-alpha.1
git push origin v1.0.0-alpha.1
```

它触发 [release.yml](/Users/ysansan/webProject/ant-chat/.github/workflows/release.yml:1)。

### 5.2 npm 产品包

tag 必须匹配 `packages/ant-chat/package.json`：

```bash
git tag ant-chat-v<npm版本>
git push origin ant-chat-v<npm版本>
```

例如：

```bash
git tag ant-chat-v1.0.0-alpha.1
git push origin ant-chat-v1.0.0-alpha.1
```

它触发 [release-npm.yml](/Users/ysansan/webProject/ant-chat/.github/workflows/release-npm.yml:1)。

## 6. Desktop 发布流程

Desktop workflow 的阶段如下：

1. 校验 tag 与 Desktop 版本一致；
2. 在 macOS runner 构建 macOS x64/arm64；
3. 在 Windows runner 构建 Windows x64；
4. 准备并校验 `rg`、Electron 原生依赖和 workspace packages；
5. 生成应用内置的 `ant-chat` launcher；
6. 在打包产物中执行 launcher smoke，确认没有 Runtime 时控制命令会失败且不会隐式启动第二个 Runtime；
7. 每个平台上传 Actions Artifact；
8. 聚合 job 检查至少包含 dmg、exe、两个 zip、两个 checksum 和更新 metadata；
9. 从当前版本的 Desktop changelog 生成 Release notes；
10. 创建或复用 GitHub Release，并上传全部已验证产物。

alpha tag 会创建 Pre-release，stable tag 创建普通 Release。安装包当前未签名或公证，Release notes 会固定说明 macOS Gatekeeper 和 Windows SmartScreen 限制。

## 7. npm 发布流程

npm workflow 的阶段如下：

1. 校验 `ant-chat-v<version>` tag；
2. 在 Ubuntu、Node.js 22 环境构建产品包和 Web UI；
3. 使用 `npm pack` 生成唯一 tarball；
4. 检查 tarball 包含：
   - `package/dist/cli.mjs`；
   - `package/dist/web/index.html`；
   - `package/package.json`；
5. 在临时目录安装 tarball；
6. 执行 `npx --no-install ant-chat --version` 和 `--help`；
7. 确认控制命令在 Runtime 未启动时不会自动启动服务；
8. 启动产品并验证 Web UI、RPC、SSE；
9. 通过 GitHub Actions OIDC Trusted Publishing 发布已验证 tarball；
10. alpha 发布到 npm `next`，stable 发布到 npm `latest`。

发布前的本地等价检查：

```bash
rm -rf /tmp/ant-chat-package
mkdir -p /tmp/ant-chat-package
cd packages/ant-chat
pnpm pack --pack-destination /tmp/ant-chat-package
```

`pnpm pack` 会在打包时把 `catalog:` 依赖展开为 `pnpm-workspace.yaml` 中定义的实际版本范围，tarball 里的 `dependencies` 是标准 npm 语义。不要用 `npm pack` 打包含 `catalog:` 引用的包——npm 不识别该协议，产物无法被任何消费者安装。

不要重新构建一个未经过 smoke 的 tarball。workflow 会把 smoke 使用的 `$TARBALL` 直接传给 `npm publish`。

## 8. 发布失败与恢复

### tag 校验失败

说明 package version 与 tag 不一致。不要强行修改 workflow；检查版本 PR 和 tag，必要时删除错误 tag 后重新创建正确 tag。

### tarball 内容或 smoke 失败

不要发布。先在本地执行 `pnpm build`、`npm pack` 和临时目录安装，修复包的 `files`、build 或资源复制问题后重新提交版本修复。

### Desktop 某个平台构建失败

聚合 job 依赖两个构建 job，任一平台失败都不会创建 Release。修复后重新运行同一个 workflow；不要手动上传未经过聚合校验的产物。

### GitHub Release 已存在

Desktop workflow 会检测已有 Release，上传阶段使用 `--clobber`。确认 tag 没有指向错误 commit 后，可以重新运行 workflow。

### npm 版本已经发布

npm workflow 会检测 `ant-chat@<version>` 是否已经存在，避免重复发布。npm 版本不可覆盖；如果 tarball 有问题，必须生成新的 patch/minor 版本，而不是重复发布同一个版本。

### Changesets status 失败

执行：

```bash
pnpm changeset status
```

如果报 mixed changeset，检查一个 changeset 是否同时包含 Changesets 配置中被忽略包和未忽略包。拆分或修正该 changeset 后再生成版本。不要通过删除无关 changeset 来绕过检查。

## 9. 发布前清单

- [ ] 当前用户可见变更已经有 changeset；
- [ ] changeset 选择了正确发行物；共享变更已确认 npm 和 Desktop 覆盖范围；
- [ ] `pnpm check` 通过；
- [ ] `pnpm build` 通过；
- [ ] `node scripts/validate-changeset.mjs origin/main` 通过；
- [ ] npm 版本和 Desktop 版本已确认；
- [ ] tag 与目标 package version 一致；
- [ ] npm tag 使用 `next` 或 `latest` 符合版本状态；
- [ ] 发布后检查 GitHub Actions、GitHub Release 资产和 npm package 页面；
- [ ] 发布后实际执行 `npx ant-chat@<tag> --version`，确认安装入口可用。
