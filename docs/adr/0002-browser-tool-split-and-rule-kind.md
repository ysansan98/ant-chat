# ADR-0002：Browser 工具拆分与 browser 权限规则 kind

将单个 `browser` 工具拆分为 11 个细粒度工具，每个工具名即权限边界；同时在封闭的权限规则联合类型中新增 `browser` kind，让拆分后的工具能生成、匹配持久规则。

兑现 ADR-0001 §3 的承诺：“Browser 暂不支持持久规则。它的指令未来拆成独立工具后再设计授权粒度。”

## 状态

已接受，2026-07-27。

与 [ADR-0001](./0001-tool-approval-rules.md) 共同生效：规则裁决顺序、deny 优先、allow 只满足交互 Turn 的 `require_approval` 等原则不变；本 ADR 只新增一种规则 kind 和拆分工具形态。

## 背景

当前 `browser` 是单个工具，input 为 `{ command: string, args: string[], timeoutMs }`。`command` 是 46 个白名单命令的自由字符串，`args` 是完全自由的字符串数组。参数约束全靠 `validateBrowserInput` 的命令式运行时检查（命令白名单 + 逐命令 flag 白名单 + 阻断 flag），模型在生成时没有 schema 级引导。

权限规则是封闭的判别联合类型，只有 `command` / `filesystem` / `mcp-tool` 三种 kind。browser 工具一个都对不上——它不是 shell 命令、不操作本地路径、不是 MCP 工具。因此 `matchRulesAgainstToolCall` 和 `createApprovalCandidates` 对 browser 显式 `return []` / `return null`：

- browser 永远匹配不到任何持久规则，每次调用都走人工审批。
- browser 生成不出候选规则，审批界面不显示“记住”选项，用户无法持久化“允许 snapshot、但 eval 永远审批”。

这两个问题耦合：只拆工具不改规则系统，拆分后仍每次审批、无法持久化；只加规则 kind 不拆工具，参数约束问题不解决且规则只能整工具粒度。两者必须一起做。

## 决策

### 1. 拆成 11 个细粒度工具，工具名即权限边界

`browser` 拆分为：

| 工具 | CLI 命令 | 参数 |
|---|---|---|
| `browser_navigate` | `open` | `url`, `headed?`, `profile?` |
| `browser_back` | `back` | — |
| `browser_reload` | `reload` | — |
| `browser_close` | `close` | — |
| `browser_snapshot` | `snapshot` | `selector?` |
| `browser_click` | `click` | `ref`/`selector`, `newTab?` |
| `browser_type` | `fill` | `ref`/`selector`, `text` |
| `browser_press` | `press` | `key` |
| `browser_scroll` | `scroll` | `direction`/`amount`, `selector?` |
| `browser_dialog` | `dialog accept`/`dismiss` | `action`, `text?` |
| `browser_eval` | `eval` | `expression` |

工具名本身就是权限边界——`browser_click` 和 `browser_type` 是不同工具，规则直接按 `toolName` 匹配，不需要在规则里再加 action 维度。这是选择细粒度而非能力簇的核心原因：4 个能力簇方案把 click/fill/press 挤在 `browser_interact` 一个 toolName 下，要区分它们就得给规则加 action 字段；细粒度方案把 action 编码进 toolName，消解了这层复杂度。

砍掉的命令（`forward`/`tab *`/`get *`/`find *`/`dblclick`/`focus`/`keydown`/`keyup`/`hover`/`select`/`check`/`uncheck`/`screenshot`/`pdf`/`download`/`wait`/`console`/`errors` 等）不可达。需要时再迭代加类型化工具，不从逃逸口透传。

### 2. 全类型化参数，关闭 args 逃逸口

每个工具的参数就是它的命令参数类型化（navigate 要 `url`，click 要 `ref`+`selector`，eval 要 `expression`），不保留 `args: string[]` 逃逸口。模型在 90% 场景有强 schema 引导，运行时校验仍兜底。

不保留逃逸口的理由：保留 `args` 等于保留无约束口子，与“参数不好约束”的改造初衷相悖。agent-browser CLI 演进时，新能力通过新增类型化工具引入，不从 `args` 透传。

### 3. 新增 browser 规则 kind

权限规则联合类型扩展为四种：

```ts
type ToolApprovalRule = CommandRule | FilesystemRule | McpToolRule | BrowserRule

interface BrowserRule extends RuleBase {
  kind: 'browser'
  toolName: string
  /** 可选，只对带 url 参数的工具（browser_navigate）生效 */
  urlPattern?: string
}
```

- `toolName` 精确匹配，不支持通配。要允许全部 browser 工具就逐个加规则，不能用 `browser_*` 一次放行——否则退化回“整个 browser 放行”，拆分白做。
- `urlPattern` 可选，只在 input 含 `url` 时校验，实际只对 `browser_navigate` 有意义。留空匹配任意 URL；填 `*.github.com` 则只匹配该域。navigate 的 URL 是天然的权限维度（github.com 与 bank.com 风险天差地别），不利用等于浪费。
- `effect` 复用现有 `allow`/`deny` 语义，deny 优先，不单独定义。
- 候选规则在审批时生成，形态为 `{ type: 'browser', toolName, urlPattern? }`，复用 ADR-0001 §8 的“后端构造候选、前端只提交选择”模式。

### 4. operationType 维持单一 'browser'，不新增 browser_read

拆分后的 11 个工具 `operationType` 统一为 `'browser'`，不新增 `browser_read`。observe 类（snapshot 等）首次仍 `require_approval`，靠 browser 规则持久化放行。

不自动放行 observe 的理由：浏览器里的“读”可能读到已登录页面的敏感数据（邮件正文、银行余额），风险性质不同于工作区内的文件 `read`。command_read 自动放行成立是因为它读的是可信工作区；browser observe 读的是带登录态的外部资源，不该套用同一策略。有了 browser 规则 kind，第一次审批后即可持久化，摩擦可接受——这正好让规则系统发挥作用，而不是靠 operationType 绕过它。

operationType 维持不变的连带收益：前端 `toolDisplay` 按 `operationType` 分类的逻辑、`decidePolicy` 和 `decideAutomationPolicy` 的 browser 分发、`hasValidResourceDomain` 的 browser 校验全部零改动，降低硬切成本。

### 5. 硬切，不保留旧 browser 工具 shim

移除旧 `browser` 工具，只暴露 11 个新工具。不保留 shim 转发。

硬切成立的条件：
- 持久化权限文件里不会有旧 browser 规则（ADR-0001 首版 browser 不生成候选），零数据迁移。
- 前端按 `operationType` 而非工具名分类显示，operationType 不变则前端分类逻辑零改动。
- `filterNativeToolsForTurn` 的 `tool.name !== 'browser'` 改为匹配 `browser_*` 前缀。
- `AgentApprovalCard` 的 `operationType !== 'browser'` 排除条件移除——拆分后 browser 工具能生成候选，“记住”按钮该显示。

不保留 shim 的理由：shim 保留无约束 `command + args` 口子，等于拆了前门又留后门，与改造目标直接相悖。

### 6. 自动化策略不改，保持 allowBrowser 单一布尔

`AutomationPermissionPolicy.allowBrowser` 维持单一布尔，不拆成按工具的标志位或白名单。

不纳入的理由：browser 规则 kind 只服务交互 Turn（ADR-0001 §1：allow 规则只参与交互 Turn），自动化是独立的无人值守权限维度。这次改造范围已经不小（拆 11 工具 + 新增 kind + 候选生成 + UI + 迁移），再叠一个自动化策略 breaking change 风险叠加。拆分后自动化即使仍全开全关，也不会比现状更差。自动化策略细化单独迭代时，可复用拆分后的 toolName 做白名单（类似现有 `allowedMcpServers` / `allowedSkills` 模式）。

## 被否决的方案

### 能力簇（4 个工具）

把 46 个命令按风险归成 navigate/observe/interact/eval 四簇，簇内用 sub-command enum 区分。被否决：簇内 click/fill/press 共享一个 toolName，要按动作授权就得给规则加 action 维度，复杂度反增；细粒度方案把 action 编码进 toolName，消解了这层复杂度。

### 全类型化 46 个命令

每个命令一套类型化字段。被否决：维护成本高，且 agent-browser CLI 一演进就漂移。细粒度方案只类型化 11 个高频命令，砍掉的命令不可达，维护成本可控。

### 保留 args 逃逸口

常用命令类型化 + 受限 `args` 透传其余。被否决：逃逸口是非类型化口子，CLI 新 flag 从 `args` 透传会绕过 schema 约束，与改造初衷相悖。

### snapshot 拆成三个工具

参照 Hermes 拆成 snapshot(文本)/vision(截图)/get_images(图片)。被否决：当前 agent-browser CLI 只支持文本无障碍树快照；截图或图片提取需要独立的类型化工具，不从 snapshot 参数伪装透传。

### browser_cdp 工具

参照 Hermes 增加 `browser_cdp` 直接执行 CDP 命令。被否决：CDP 命令空间开放，规则无法按 action 区分，比 eval 更危险（eval 只在页面上下文，cdp 能控制浏览器本身），与细化权限目标直接冲突。

### observe 自动放行（新增 browser_read）

observe 类首次免审批。被否决：browser observe 读的是带登录态的外部资源，敏感数据泄露风险不同于工作区 read；靠规则持久化放行更安全，且让规则系统发挥作用。

## 不纳入首版

- `browser_cdp` 或任何绕过 CLI 白名单的原始 CDP 入口。
- `console`/`errors` 工具（当前 `ALLOWED_COMMANDS` 未放行，属于新增能力，超出“拆分”范围）。
- 自动化策略细化（`allowBrowser` 拆成按工具白名单）。
- snapshot 的 vision/get_images 独立工具。
- 砍掉的命令的透传或逃逸口。
