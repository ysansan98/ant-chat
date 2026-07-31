# 飞书卡片使用模式与 ant-chat 落地建议

> 调研日期：2026-07-31
> 参考仓库：[`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge/tree/ec57a8851b172978eddd329757f813954bcb2294)
> 固定源码版本：`ec57a8851b172978eddd329757f813954bcb2294`

## 结论

参考仓库最值得复用的不是某一张卡片，而是四个稳定模式：

1. 用 CardKit 2.0 的同一张卡承载 `运行中 → 等待交互 → 成功/失败/取消` 状态变化。
2. 卡片只承载展示和用户意图；真正的会话、审批、模型等状态仍由后端 owner 管理。
3. 按钮只回传不透明、短生命周期、一次性 token；服务端再次校验操作者、会话、任务和当前状态。
4. 回调在 3 秒内快速响应，耗时业务异步执行，再把原卡更新为无按钮的终态卡。

参考仓库实际有流式执行、停止、模型/配置表单、工作区切换、会话恢复、状态和帮助卡。它没有独立的工具审批卡：Codex 启动参数明确使用 `approval_policy="never"`。提问也不是固定业务模板，而是 Agent 生成任意卡片后，通过签名回调恢复同一会话。因此，提问和审批只能复用其回调机制，不能把参考仓库描述成已有完整实现。

ant-chat 当前工作区有一套未提交、未跟踪的 `packages/backend/src/channels/**` 在建实现。下文把它称为“本地在建实现”，不能当成 `HEAD` 或已发布能力。

## 场景总表

| 使用场景 | 参考仓库实际实现 | ant-chat 可复用程度 | 推荐卡片 |
| --- | --- | --- | --- |
| Agent 流式执行 | CardKit 2.0，思考、文本、工具、状态和停止按钮在同一卡片更新 | 直接复用模式；本地在建实现已有 execution projection | 执行状态卡 |
| Agent 提问/澄清 | 无固定模板；Agent 可发送带签名 callback 的自定义按钮/表单 | 需要新增领域协议和等待态 | 选择题卡 / 表单提问卡 |
| 工具审批 | 无业务模板；Codex 禁止原生审批 | ant-chat 已有真实审批 owner，本地在建实现已接一次批准/拒绝 | 执行卡的审批态 |
| 切换模型 | `/config` 中用 `form + select_static` | 本地在建实现已有模型列表、一次性 token 和会话设置更新 | 模型选择卡 |
| 停止任务 | 流式卡底部危险按钮，签名回调绑定当前 run | 可映射到 Agent task stop | 执行卡的停止动作 |
| 会话恢复 | 历史条目 + 每条恢复按钮 | 需要 ChannelSession/Conversation 查询接口 | 会话选择卡 |
| 工作区切换 | 当前 cwd + 命名工作区 + 切换/删除按钮 | 可映射，但必须复用已登记工作区校验 | 工作区选择卡 |
| 状态/帮助 | Markdown 摘要 + 导航按钮 | 可直接作为频道命令结果 | 状态卡 / 帮助卡 |
| 偏好配置 | 大表单，选择模型、回复方式、工具显示、并发等 | 只建议低风险偏好；不要在卡片输入秘密 | 设置表单卡 |
| OAuth/权限补充 | 说明文案 + 授权链接，完成后原卡改成功态 | 可复用 | 外部授权卡 |
| 密钥输入 | 参考仓库有 App Secret 表单 | 不采用 | 桌面端完成，飞书只显示引导 |

## 参考仓库的真实卡片结构

### 1. 普通命令卡：标题、正文、动作区

工作区、状态、恢复会话、帮助卡共用一个简单 shell：

```jsonc
{
  "config": {
    "wide_screen_mode": true,
    "update_multi": true
  },
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "卡片标题"
    }
  },
  "elements": [
    {
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": "正文"
      }
    },
    {
      "tag": "action",
      "actions": [
        {
          "tag": "button",
          "text": {
            "tag": "plain_text",
            "content": "执行"
          },
          "type": "primary",
          "value": {
            "cmd": "status"
          }
        }
      ]
    }
  ]
}
```

来源：

- 通用 shell、按钮和 action 构造：[templates.ts#L1-L32](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/templates.ts#L1-L32)
- 工作区切换/删除：[templates.ts#L34-L62](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/templates.ts#L34-L62)
- 状态卡和导航按钮：[templates.ts#L87-L133](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/templates.ts#L87-L133)
- 会话恢复：[templates.ts#L145-L178](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/templates.ts#L145-L178)

这部分还是旧卡片结构。ant-chat 新代码不应继续混用旧版；统一输出 CardKit JSON 2.0。

### 2. 执行流式卡：一个状态投影持续更新

参考仓库将 Agent event 归约为 `RunState`，再渲染为 CardKit 2.0：

```jsonc
{
  "schema": "2.0",
  "config": {
    "streaming_mode": true,
    "summary": {
      "content": "正在调用工具"
    }
  },
  "body": {
    "elements": [
      {
        "tag": "collapsible_panel",
        "expanded": false,
        "header": {
          "title": {
            "tag": "markdown",
            "content": "🧠 **思考中**"
          }
        },
        "elements": [
          {
            "tag": "markdown",
            "content": "思考摘要"
          }
        ]
      },
      {
        "tag": "markdown",
        "content": "正在输出的回答"
      },
      {
        "tag": "button",
        "text": {
          "tag": "plain_text",
          "content": "⏹ 终止"
        },
        "type": "danger",
        "behaviors": [
          {
            "type": "callback",
            "value": {
              "__bridge_cb": true,
              "bridge_token": "<signed-token>",
              "cmd": "stop"
            }
          }
        ]
      }
    ]
  }
}
```

实际行为：

- `running` 时打开 `streaming_mode`，终态关闭；摘要随思考、工具、输出、完成等状态改变。
- 工具少时逐个展示；工具多时折叠旧工具，只保持最新运行项展开，避免卡片体积失控。
- `interrupted / idle_timeout / error / done` 都是同一张卡的终态，不再产生另一套消息。
- 停止按钮只在运行态存在。

来源：

- CardKit 2.0、streaming 和终态渲染：[run-renderer.ts#L22-L65](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/run-renderer.ts#L22-L65)
- 工具折叠规则和体积约束：[run-renderer.ts#L83-L143](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/run-renderer.ts#L83-L143)
- 停止按钮和签名回调：[run-renderer.ts#L183-L195](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/run-renderer.ts#L183-L195)
- Agent event 到运行状态的 reducer：[run-state.ts#L32-L140](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/run-state.ts#L32-L140)
- 流式创建和持续 `ctrl.update`：[channel.ts#L1079-L1137](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/bot/channel.ts#L1079-L1137)

### 3. 配置表单：`form + select_static + submit`

参考仓库的模型切换不是单独卡，而是 `/config` 表单的一项：

```jsonc
{
  "schema": "2.0",
  "config": {
    "summary": {
      "content": "偏好设置"
    }
  },
  "body": {
    "elements": [
      {
        "tag": "form",
        "name": "config_form",
        "elements": [
          {
            "tag": "markdown",
            "content": "**模型**\n选择当前 Agent 使用的模型"
          },
          {
            "tag": "select_static",
            "name": "model",
            "initial_option": "model-id",
            "options": [
              {
                "text": {
                  "tag": "plain_text",
                  "content": "模型名称"
                },
                "value": "model-id"
              }
            ]
          },
          {
            "tag": "button",
            "name": "submit_btn",
            "text": {
              "tag": "plain_text",
              "content": "提交"
            },
            "type": "primary",
            "form_action_type": "submit",
            "behaviors": [
              {
                "type": "callback",
                "value": {
                  "cmd": "config.submit"
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

来源：

- 模型选择器：[config-card.ts#L157-L171](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/config-card.ts#L157-L171)
- 表单提交/取消：[config-card.ts#L289-L328](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/config-card.ts#L289-L328)
- `form_value` 读取和模型合法性复验：[commands/index.ts#L1781-L1799](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/commands/index.ts#L1781-L1799)
- CardKit 表单值位于 raw event 的 `action.form_value`：[dispatcher.ts#L45-L60](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/dispatcher.ts#L45-L60)

### 4. 回调分发：卡片不直接修改业务状态

参考仓库有两条分发路径：

1. 内建命令按钮：`value.cmd` 进入命令 handler。
2. Agent 生成按钮：带 `__bridge_cb` 和签名 token，验证后变成 `[card-click] {...}`，重新送入同一 scope 的 Agent 队列。

来源：

- 内建命令和 Agent callback 分流：[dispatcher.ts#L45-L139](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/dispatcher.ts#L45-L139)
- callback 还原成同一会话的输入：[dispatcher.ts#L163-L198](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/dispatcher.ts#L163-L198)
- HMAC token 绑定 run、scope、chat、operator、action、策略指纹、过期时间和 nonce：[callback-auth.ts#L78-L123](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/callback-auth.ts#L78-L123)
- 服务端重新比对全部上下文：[callback-auth.ts#L133-L144](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/callback-auth.ts#L133-L144)

## ant-chat 推荐卡片

以下 JSON 表示平台 adapter 的输出，不表示应把飞书 DSL 放进 Agent runtime。Agent runtime 只产生平台无关的领域事件，`FeishuCardRenderer` 才负责生成这些结构。

### A. Agent 提问卡

#### 适用场景

- Agent 需要用户在 2～5 个互斥选项中选择。
- 问题有明确 `requestId`，回答后应恢复原任务，而不是启动一个无关联的新 turn。

#### 推荐领域协议

```ts
interface AgentInputRequest {
  requestId: string
  taskId: string
  question: string
  options: Array<{ id: string, label: string, description?: string }>
  allowFreeText: boolean
  expiresAt: number
}
```

#### 短选项卡

```jsonc
{
  "schema": "2.0",
  "config": {
    "update_multi": true,
    "summary": {
      "content": "Agent 需要你的回答"
    }
  },
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "需要确认"
    },
    "template": "blue"
  },
  "body": {
    "elements": [
      {
        "tag": "markdown",
        "content": "**选择部署方式**\n这个选择会影响后续生成的配置。"
      },
      {
        "tag": "button",
        "text": {
          "tag": "plain_text",
          "content": "本地部署"
        },
        "type": "primary",
        "behaviors": [
          {
            "type": "callback",
            "value": {
              "token": "<opaque-one-time-token>"
            }
          }
        ]
      },
      {
        "tag": "button",
        "text": {
          "tag": "plain_text",
          "content": "云端部署"
        },
        "behaviors": [
          {
            "type": "callback",
            "value": {
              "token": "<opaque-one-time-token>"
            }
          }
        ]
      }
    ]
  }
}
```

#### 自由输入/组合问题

使用 `form`，输入框和选择器必须有全卡唯一 `name`；提交后从 `event.action.form_value` 读取。

```jsonc
{
  "schema": "2.0",
  "config": {
    "update_multi": true,
    "summary": {
      "content": "Agent 需要补充信息"
    }
  },
  "body": {
    "elements": [
      {
        "tag": "form",
        "name": "question_form",
        "elements": [
          {
            "tag": "markdown",
            "content": "**发布环境是什么？**"
          },
          {
            "tag": "select_static",
            "name": "environment",
            "options": [
              {
                "text": {
                  "tag": "plain_text",
                  "content": "测试环境"
                },
                "value": "staging"
              },
              {
                "text": {
                  "tag": "plain_text",
                  "content": "生产环境"
                },
                "value": "production"
              }
            ],
            "required": true
          },
          {
            "tag": "markdown",
            "content": "**补充说明**"
          },
          {
            "tag": "input",
            "name": "note",
            "placeholder": {
              "tag": "plain_text",
              "content": "可选"
            },
            "input_type": "text"
          },
          {
            "tag": "button",
            "name": "submit",
            "text": {
              "tag": "plain_text",
              "content": "提交回答"
            },
            "type": "primary",
            "form_action_type": "submit",
            "behaviors": [
              {
                "type": "callback",
                "value": {
                  "token": "<opaque-one-time-token>"
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

#### 终态

按钮一经消费，原卡更新为：

```text
✅ 已回答：生产环境
```

并移除全部输入控件。重复点击、过期点击和非授权操作者不得再次恢复任务。

#### 当前缺口

ant-chat 目前没有 `awaiting_input`、`AgentInputRequest` 或 question resolver。模型输出普通提问文本时，Agent loop 会直接成功结束；飞书下一条文本也会启动新 turn，无法可靠关联到哪个问题。因此不能靠识别问号或自然语言把普通文本自动变成提问卡。

本地证据：

- 任务状态没有等待用户输入：`packages/shared/src/interfaces/agent-runtime.ts:25`
- 无工具调用时 Agent loop 结束当前 turn：`packages/backend/src/agent-core/loop/agentLoop.ts:162`
- 频道普通文本直接调用 `startTurn`：`packages/backend/src/channels/channelRuntime.ts:92`

### B. 工具审批卡

#### 适用场景

- ant-chat 权限 owner 已经判定 `require_approval`。
- 只允许“本次批准”或“拒绝”。
- “记住授权”继续留在桌面端，因为它需要展示和确认候选规则、作用域和收窄后的资源身份。

#### 推荐结构

审批不是新发一张孤立卡，而是执行卡的 `awaiting_approval` 状态：

```jsonc
{
  "schema": "2.0",
  "config": {
    "update_multi": true,
    "summary": {
      "content": "等待审批"
    }
  },
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "等待审批"
    },
    "template": "orange"
  },
  "body": {
    "elements": [
      {
        "tag": "markdown",
        "content": "**工具**：execute_command\n**范围**：当前工作区\n**操作预览**：`pnpm build`\n\n飞书仅支持本次批准；记住授权请在 Ant Chat 桌面端操作。"
      },
      {
        "tag": "button",
        "text": {
          "tag": "plain_text",
          "content": "仅本次批准"
        },
        "type": "primary",
        "behaviors": [
          {
            "type": "callback",
            "value": {
              "token": "<opaque-one-time-token>"
            }
          }
        ]
      },
      {
        "tag": "button",
        "text": {
          "tag": "plain_text",
          "content": "拒绝"
        },
        "type": "danger",
        "behaviors": [
          {
            "type": "callback",
            "value": {
              "token": "<opaque-one-time-token>"
            }
          }
        ]
      }
    ]
  }
}
```

token 服务端记录的真实 action 应至少绑定：

```ts
{
  kind: 'approval.approve' | 'approval.reject'
  channelAccountId: string
  externalChatId: string
  operatorUserId: string
  conversationId: string
  taskId: string
  actionId: string
  expiresAt: number
}
```

回调必须重新检查：

1. 飞书身份仍已配对；
2. 卡片属于当前 channel account 和 chat；
3. 当前 conversation 仍是卡片创建时的 conversation；
4. task 仍存在、来自该频道且仍为 `awaiting_approval`；
5. `pendingAction.actionId` 仍匹配；
6. token 未消费且未过期。

通过后才调用 `AgentRuntime/TaskStore` 的批准或拒绝 API。飞书 adapter 不得直接执行工具，也不得自己持久化权限规则。

本地在建实现已具备 task/action 复验主链，但还没有把动作绑定到原消息操作者：

- 平台无关 action 和 execution 内容：`packages/backend/src/channels/channelConnector.ts:10`
- 审批动作生成：`packages/backend/src/channels/channelDelivery.ts:265`
- 飞书审批展示：`packages/backend/src/channels/feishu/card.ts:31`
- 点击者配对状态、会话、任务来源和 actionId 复验：`packages/backend/src/app-runtime/modules/channel/index.ts:234`
- 真正审批 owner：`packages/backend/src/agent-core/taskStore.ts:108`、`packages/backend/src/agent-core/AgentRuntime.ts:108`

当前 `RegisteredAction` 只绑定 channel account 和 chat；任一已配对用户都可能点击，没有绑定发起该任务的 `externalUserId`。落地前必须把原消息操作者从 `ChannelInboundEvent → turnSource/execution projection → RegisteredAction` 贯通，并在 callback 中校验。群聊如果产品上允许其他审批人代批，也必须建立显式审批人策略，不能把“已配对”隐式当成授权。

终态应更新原卡并移除按钮：

```text
✅ 已批准，本次任务继续执行
```

或：

```text
⛔ 已拒绝该操作
```

### C. 模型切换卡

#### 适用场景

- `/models` 或卡片入口查看当前会话可用模型。
- 选择只影响当前频道会话，不修改全局默认模型。

模型数量不超过 5 个时可以用按钮；常规模型列表建议用 `form + select_static`，避免一模型一按钮导致卡片过长。

```jsonc
{
  "schema": "2.0",
  "config": {
    "update_multi": true,
    "summary": {
      "content": "选择模型"
    }
  },
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "选择模型"
    },
    "template": "blue"
  },
  "body": {
    "elements": [
      {
        "tag": "markdown",
        "content": "选择后应用到当前频道会话。"
      },
      {
        "tag": "form",
        "name": "model_form",
        "elements": [
          {
            "tag": "select_static",
            "name": "model",
            "initial_option": "provider-id/model-id",
            "options": [
              {
                "text": {
                  "tag": "plain_text",
                  "content": "OpenAI / GPT-5"
                },
                "value": "provider-id/model-id"
              }
            ],
            "required": true
          },
          {
            "tag": "button",
            "name": "submit",
            "text": {
              "tag": "plain_text",
              "content": "切换模型"
            },
            "type": "primary",
            "form_action_type": "submit",
            "behaviors": [
              {
                "type": "callback",
                "value": {
                  "token": "<opaque-one-time-token>"
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

注意：

- option `value` 使用稳定 identity，不使用展示 label。
- 服务端仍根据当前 provider catalog 重新查找模型，不信任回传值。
- 回调时确认 active conversation 未改变；否则提示卡片已过期。
- 成功后把原卡替换为 `模型已切换：OpenAI / GPT-5`。

本地在建实现已有模型选择的表现和会话级数据，但 owner 仍需修正：

- `/models` 的平台无关 presentation 和当前选中态：`packages/backend/src/channels/channelRuntime.ts:147`
- 对回传 provider/model 再查 catalog：`packages/backend/src/channels/channelRuntime.ts:125`
- 一次性 action token：`packages/backend/src/channels/channelDelivery.ts:100`
- active conversation 复验和终态更新：`packages/backend/src/app-runtime/modules/channel/index.ts:249`

当前 `ChannelRuntime.selectModel/setModel` 直接调用 `conversationRepository.update`，绕过了统一的 `ConversationLifecycle.update`，因此不会发出 `conversation:updated`，已加载该会话的桌面/Web 端可能不同步。模型切换必须依赖 `ConversationLifecycle` 或它暴露的最小 settings 接口；不能认可 repository 直写为最终 owner。统一 owner 见 `packages/backend/src/conversations/conversationLifecycle.ts:157`，Chat 模块的正确调用方式见 `packages/backend/src/app-runtime/modules/chat/index.ts:115`。

当前飞书 renderer 是“一模型一按钮”。建议保留平台无关 `model-selection` 协议，只在 Feishu renderer 内根据模型数量选择按钮或 `select_static`。

### D. 运行状态卡

#### 推荐状态映射

| Agent 状态 | 标题 | 颜色 | 动作 |
| --- | --- | --- | --- |
| `running` | 正在执行 | blue | 停止（待新增 `task.cancel`） |
| `awaiting_approval` | 等待审批 | orange | 本次批准、拒绝 |
| `success` | 执行完成 | green | 无 |
| `failed` | 执行失败 | red | 无 |
| `cancelled` | 执行已停止 | grey | 无 |

正文按以下顺序组织：

1. 当前回答文本；
2. 当前阶段，如等待模型、思考、准备工具、使用工具、生成回复；
3. 工具步骤摘要；
4. 可视化摘要和“桌面端查看完整内容”；
5. 审批或敏感信息提示；
6. 当前模型；
7. 当前状态允许的动作。

本地在建实现的平台边界方向正确：

- `ChannelDelivery` 订阅 Agent 与消息事件，维护 execution projection：`packages/backend/src/channels/channelDelivery.ts:56`
- Feishu renderer 只负责状态到 DSL：`packages/backend/src/channels/feishu/card.ts:13`
- `ChannelConnector.send/update/setTyping` 是平台边界：`packages/backend/src/channels/channelConnector.ts:58`

仍有三个缺口：

1. `ChannelDelivery.handleTaskUpdate` 没有把 `task.summary/errorMessage` 放入 projection；模型产出文本前失败时，失败卡可能为空或保留旧正文。应在 projection owner 修复，不在飞书 renderer 猜错误。
2. action token 只存在进程内 `Map`，重启后全部失效。若要求跨重启继续处理卡片，需要持久化 token hash、绑定上下文、过期时间和消费状态。
3. 当前 `ChannelInteractionAction` 和 `executionActions` 没有 cancel action，运行卡实际上不能停止任务。若保留停止按钮，必须新增平台无关 `task.cancel`，绑定 task/execution/origin，回调调用 Agent 的取消 owner，并覆盖重复点击、已终止任务和错误操作者测试。

### E. 状态、帮助、会话和工作区卡

这些场景共用“摘要 + 列表 + 操作”的结构即可：

```jsonc
{
  "schema": "2.0",
  "config": {
    "update_multi": true,
    "summary": {
      "content": "当前状态"
    }
  },
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "当前状态"
    },
    "template": "blue"
  },
  "body": {
    "elements": [
      {
        "tag": "markdown",
        "content": "**工作区**：`/repo`\n**会话**：`abc123`\n**模型**：OpenAI / GPT-5\n**任务**：正在运行"
      },
      {
        "tag": "button",
        "text": {
          "tag": "plain_text",
          "content": "新会话"
        },
        "type": "primary",
        "behaviors": [
          {
            "type": "callback",
            "value": {
              "token": "<opaque-one-time-token>"
            }
          }
        ]
      }
    ]
  }
}
```

工作区切换必须只显示已登记且仍可用的工作区，并在点击时重新走 `canonicalizeWorkspacePath + isRegisteredWorkspace`。不得把任意路径从卡片回传后直接设为 cwd。

### F. OAuth/外部授权卡

卡片仅显示：

- 为什么需要授权；
- 授权范围；
- 有效期；
- `open_url` 按钮或链接；
- 完成后的刷新说明。

外部授权完成后，把原卡替换为成功态。参考仓库已有“群消息权限缺失 → 授权链接 → 原卡成功态”的完整模式：[config-card.ts#L378-L423](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/config-card.ts#L378-L423)。

## 卡片生命周期

```text
领域事件产生
  → ChannelDelivery 建立平台无关 projection
  → FeishuCardRenderer 生成 CardKit JSON 2.0
  → 创建 card entity，得到 card_id
  → 发送引用 card_id 的 interactive message
  → 保存 localMessageId ↔ externalMessageId ↔ cardId
  → 状态变化时按严格递增 sequence 更新同一卡片
  → 用户点击后 3 秒内返回 {} 或 toast
  → 服务端校验并消费一次性 token
  → 调用真实领域 owner
  → 异步更新为下一状态或无按钮终态
```

这是本文推荐的 CardKit entity 合同，不是本地在建实现的现状。当前 `FeishuTransport` 仍发送 raw interactive JSON，再通过 `im.message.patch` 更新消息；receipt 也没有 `cardId`。实施时必须二选一：继续 raw message patch，并删除对 cardId/sequence 的依赖；或者新增 managed-card adapter、持久化 cardId，并明确 sequence owner。本文推荐后者，不能让两套更新合同同时成为默认路径。

参考仓库的 managed card：

- 创建 card entity，发送失败时回退 raw card：[managed.ts#L29-L54](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/managed.ts#L29-L54)
- CardKit 更新按 sequence 递增：[managed.ts#L62-L87](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/managed.ts#L62-L87)

参考仓库还记录了一个真实客户端约束：表单提交后短时间内，客户端的本地提交态可能覆盖服务端卡片更新。因此它先快速结束 cardAction handler，等待约 1 秒，再更新原卡；失败时把旧表单改成静态失败记录，另发一张新表单重试。[commands/index.ts#L1371-L1435](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/commands/index.ts#L1371-L1435)

不要把这 1 秒当飞书公开协议。我们的稳定实现应遵循官方合同：3 秒内响应回调，响应完成后再做延时更新。

## 安全与可靠性要求

### 必须做到

1. 只订阅新版 `card.action.trigger`，避免新旧回调重复。
2. 回调 3 秒内返回；耗时操作异步执行。
3. 用 `header.event_id` 做防御性去重，但业务状态仍用 CAS/当前状态校验。
4. action payload 只放不透明 token，不放可信的 `taskId/actionId/providerId/modelId` 作为唯一依据。
5. token 绑定 channel account、chat、operator、conversation、领域 action、过期时间，并一次性消费。
6. 所有回调再次检查操作者配对状态和资源归属。
7. 审批继续由 `AgentRuntime/TaskStore` 完成；模型切换继续由 conversation settings owner 完成。
8. CardKit 全量更新使用严格递增 `sequence`；同批更新使用 `uuid` 幂等。
9. 流式卡在交互窗口暂停更新，交互结束后再恢复。
10. 卡片终态删除所有动作，旧 token 同时撤销。

### 明确禁止

- 不把 App Secret、Token、密码、SecretRequest 的值放入飞书卡片或回调。
- 不允许飞书卡片创建“记住授权”规则。
- 不从按钮 label 推导 action identity。
- 不因为飞书回调成功就跳过 ant-chat 自身的 task/action/state 校验。
- 不把飞书普通消息事件的重试语义误套到卡片 callback；官方明确 callback 不提供补推。
- 不把参考仓库普通 `{cmd}` 按钮的低风险访问控制直接用于工具审批。

参考仓库账号表单包含 App Secret 输入，并明确承认预填 secret 可能进入飞书服务端卡片缓存：[account-cards.ts#L48-L77](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/ec57a8851b172978eddd329757f813954bcb2294/src/card/account-cards.ts#L48-L77)。ant-chat 不采用这个设计；现有本地在建实现要求敏感信息在桌面端输入的方向正确：`packages/backend/src/channels/channelDelivery.ts:247`。

## 对 ant-chat 在建实现的具体建议

按优先级：

1. 保留 `ChannelOutboundContent → FeishuCardRenderer` 平台边界，不把飞书 DSL 渗入 Agent runtime。
2. 保留现有审批卡的一次批准/拒绝和 task/action 复验；补齐原消息操作者绑定。
3. 把模型列表从“一模型一按钮”改成：不超过 5 个用按钮，超过 5 个用 `select_static + submit`。
4. 模型设置改走 `ConversationLifecycle` 的统一更新入口，保留 `conversation:updated`。
5. 给 execution projection 补 `summary/errorMessage`，覆盖模型输出前失败。
6. 统一卡片更新合同。本文选择 CardKit entity：新增 managed-card adapter、持久化 cardId，并明确 sequence owner；删除默认 raw patch 路径，避免两套语义并存。
7. 新增平台无关 `task.cancel` action 后再展示停止按钮。
8. action registry 增加 operator 绑定、TTL、消费状态和清理；若产品要求跨重启操作，再做持久化。
9. 新增 `AgentInputRequest + awaiting_input + resolver` 后再实现提问卡，不做自然语言启发式识别。
10. 为 form callback 扩展规范化事件，使其带类型化 `formValue`；当前只读取 `action.value.token` 不足以支撑表单。
11. 统一 CardKit JSON 2.0，不继续复用参考仓库的旧卡片 `elements/button.value` 结构。
12. 为卡片回调增加行为测试：重复点击、过期 token、错误用户、错误 chat、会话已切换、任务已结束、重启后 token、更新失败。

## 飞书官方合同

- [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create?lang=zh-CN)：`msg_type=interactive`，`content` 为序列化后的卡片 JSON。
- [回复消息](https://open.feishu.cn/document/server-docs/im-v1/message/reply?lang=zh-CN)：可用 `uuid` 做发送幂等。
- [发送消息内容结构](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/create_json)：卡片消息内容格式。
- [处理卡片回调](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/handle-card-callbacks?lang=zh-CN)：新版回调、3 秒响应、toast、延时更新和 callback 不补推。
- [创建卡片实体](https://open.feishu.cn/document/cardkit-v1/card/create?lang=zh-CN)：仅支持 JSON 2.0；card entity 只能发送一次，有效 14 天，卡片建议不超过 30KB。
- [全量更新卡片实体](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/cardkit-v1/card/update)：`sequence` 严格递增，`uuid` 用于幂等。
- [流式更新卡片](https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview)：流式开关、更新频率和交互窗口约束。
- [输入框组件](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/input)：`name`、`required` 和 `form_value`。
- [事件回调验签](https://open.feishu.cn/document/event-subscription-guide/callback-subscription/receive-and-handle-callbacks?lang=zh-CN)：HTTP webhook 的 Encrypt Key、时间戳、nonce 和签名校验。

## 证据边界

- 参考仓库结论来自固定 commit 的源码，不代表其未来版本。
- `@larksuite/channel` 为参考仓库使用的 SDK；其便捷 API 不是飞书平台合同。落地时以飞书官方 OpenAPI 为准。
- 参考仓库使用长连接接收 cardAction；如果 ant-chat 继续使用长连接，不需要照搬 HTTP webhook 验签，但业务 token、操作者绑定、幂等和状态复验仍然必须保留。
- ant-chat 的 `packages/backend/src/channels/**` 是调研时工作区内的未提交在建实现，本文只据此判断接缝和缺口，不宣称其已发布。
