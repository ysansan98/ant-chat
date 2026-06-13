# @ant-chat/local-server

Ant Chat 的本地 Web 服务，包含 Web UI、RPC API 和实时事件服务。

## 使用

```bash
npx @ant-chat/local-server
```

默认地址为 `http://127.0.0.1:3456`，数据保存在 `~/.ant-chat`。

指定端口：

```bash
npx @ant-chat/local-server --port 8080
```

允许局域网访问：

```bash
npx @ant-chat/local-server --host --port 8080
```

`--host` 会监听 `0.0.0.0`。服务当前不提供鉴权，请只在可信网络中使用。
