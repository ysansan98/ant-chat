# ant-chat

Ant Chat 的本地 Agent 产品运行时，包含 Agent Runtime、Web UI、RPC API、SSE 和控制 CLI。

## 使用

```bash
npx ant-chat
```

默认地址为 `http://127.0.0.1:3456`，数据保存在 `~/.ant-chat`。

指定端口：

```bash
npx ant-chat start --port 8080
```

允许局域网访问：

```bash
npx ant-chat --host --port 8080
```

控制已有 Runtime：

```bash
ant-chat settings show --json
ant-chat provider list --json
ant-chat mcp list --json
```

数据目录默认是 `~/.ant-chat`，可以通过 `--data-dir <path>` 或 `ANT_CHAT_DATA_ROOT` 覆盖。`--host` 开放的是当前无 HTTP 鉴权的 Web UI、RPC 和 SSE，只允许可信局域网或受控网络使用，禁止直接暴露到公网。

开发隔离：设置 `ANT_CHAT_ENV=development` 后，数据目录变为 `~/.ant-chat-dev`，Keychain service 变为
`ant-chat-dev`，与生产环境的 `~/.ant-chat` 和 `ant-chat` 互不共享，避免本地切换开发/生产运行时反复触发
macOS 钥匙串授权弹窗。
