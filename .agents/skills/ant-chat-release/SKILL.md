---
name: ant-chat-release
description: 在 ant-chat 仓库执行版本发布或排查发布失败时使用。触发词包括"发布/发版/打 tag/alpha.N/要不要 changeset/CI 发布失败"等。覆盖两个发行物（npm 产品包 ant-chat 与 Desktop @ant-chat/desktop）的版本生成、tag 规则、release workflow 触发与已知坑。
---

# Ant Chat 发布

## 两个发行物（版本独立，各跟随自己的 changeset）

| 发行物 | 版本来源 | tag 格式 | 触发 workflow |
| --- | --- | --- | --- |
| npm 产品包 `ant-chat` | `packages/ant-chat/package.json` | `ant-chat-v<版本>` | `release-npm.yml` |
| Desktop `@ant-chat/desktop` | `apps/desktop/package.json` | `v<版本>` | `release.yml` |

## 是否要 changeset（判断用户可见变更）

- 要：功能/行为/性能/兼容/安全变化，CLI/Web UI/RPC/SSE/runtime 行为，桌面窗口/安装包/权限/内置 skill，共享包影响发行物，修复用户实际遇到的错误，依赖升级改变产物。
- 不要：`docs/`、根 README、`.github/`（不改变产品行为）、纯测试/类型/内部重命名、锁文件无行为变化。
- 用 `node scripts/validate-changeset.mjs origin/main` 辅助验证（在干净工作区跑，version 产物会误报）。

## 发行物选择（影响面规则）

- 除 `apps/desktop/**` 外，产品代码几乎同时进入两个发行物（`ant-chat` 的 tsdown 内联 backend/control-client/shared 的 src + `apps/web` 构建产物；desktop 无独立 renderer，界面即 `apps/web`）→ 用户可见变更应**同时**选 `ant-chat` 和 `@ant-chat/desktop`，拿不准就双选。
- 只选 `@ant-chat/desktop`：仅改 Electron 主进程/preload/安装包/窗口资源。
- 内部包 `backend`/`shared`/`control-client`/`ui`/`web` 不独立发布。
- 教训：iLink 频道（#89）改了 backend+web 却只选 `ant-chat`，桌面版漏发、需事后补版本。

## 发布步骤

1. 确认 main 干净、待发布变更已合并。
2. `pnpm version-packages`（pre 模式每次 bump alpha.N）。
3. `pnpm install --lockfile-only`：检查 lockfile diff，只应有受影响的 importer；出现无关 catalog 版本浮动时，还原后手动精准修改或改 `--fix-lockfile`。
4. `pnpm check && git diff --check`。
5. 提交：`chore: release ...`。
6. 打 tag（版本必须与对应 package.json 一致）并推送，触发对应 workflow。
7. `gh run watch <run-id> --exit-status` 等待；发布后验证：
   - desktop：`gh release view v<版本>` 含 dmg/exe/zip/SHA256SUMS。
   - npm：`npm view ant-chat@<版本>`；临时目录 `npm install ant-chat@<tag>` 后 `--version` 可用。

## 已知坑（按出现顺序排查）

1. **tag 与版本不一致**：workflow 第一步校验失败。删 tag 重建并重新推送。
2. **`npm pack` 报 `EUNSUPPORTEDPROTOCOL catalog:`**：发布物不能含 pnpm `catalog:` 死引用。必须用 `pnpm pack`（自动展开为实际版本），不要用 `npm pack`。
3. **`__dirname` ReferenceError（ESM bundle）**：`@larksuiteoapi/node-sdk` 的 user-agent 模块用 `__dirname`，需 tsdown `external` + 声明运行时依赖（按 CJS 加载）。
4. **Ubuntu smoke 报 `libsecret-1.so.0`**：keytar 运行时依赖。`release-npm.yml` 需 `apt-get install libsecret-1-0`（与 `ci.yml` 一致）。
5. **npm publish 404**：全新包名需先在 npmjs.com 配置 Trusted Publisher（GitHub Actions / `ysansan98` / `ant-chat` / `release-npm.yml` / Allow npm publish）。已发布版本 CI 会检测并跳过。
6. **本地发布**：仓库 `.npmrc` 指向 npmmirror（只读镜像），必须显式 `--registry=https://registry.npmjs.org/`；账号 2FA 为 auth-and-writes，发布需 `--otp` 或 bypass 2FA 的 granular token。

## 详细参考

- `docs/release-guide.md`：完整流程、失败恢复、发布前清单。
