# docs 文档与现状不符项清单

> 审查日期：2026-10-15
> 审查基线：当前工作区 HEAD（含未提交改动为零的干净状态）
> 审查范围：docs/ 下全部 31 个 Markdown 文档（agents 10、adr 5、plan 8、research 2、顶层 6）
> 审查方法：提取每个文档中可验证的事实性声明（命令、路径、包名、接口、配置、标签、流程），逐条与代码、package.json、CI workflow、GitHub 线上状态交叉验证；高影响发现均经二次抽查确认。
>
> **用途**：逐项决策「调整文档」还是「修正代码」。每项附初步建议与决策栏，直接在文档中勾选或批注即可。
>
> **实施说明（2026-10-28）**：`docs/agents/` 下的 `architecture.md`、`code.md`、`communication.md`、`execution.md`、`git-workflow.md`、`testing.md`、`tooling.md` 被 `.gitignore` 忽略，属于本机个人文档，**未纳入本分支提交**。这些文件的修正已在本机工作区完成，需要随本机文件同步；其余文档修正已提交。

## 总览

| 分类 | 数量 | 说明 |
| --- | --- | --- |
| 完全符合现状 | 10 | 见文末清单 |
| 存在不符项 | 21 | 即下方决策项 |
| 高影响（误导执行/安全声明失实） | 7 | D01–D07 |
| 中影响（状态过时/演进未同步） | 11 | D08–D18 |
| 低影响/待定 | 6 | D19–D24 |

判定分类含义：

- **文档过时**：代码/配置已演进，文档未同步——通常改文档即可；
- **代码偏离文档**：文档描述的预期行为，代码未实现或方向相反——需决策改哪边；
- **语义模糊**：两种读法都成立，需人工判断。

---

## 一、高影响决策项（D01–D07）

### D01 GitHub triage / wayfinder 标签全部与线上不符 ⚠️

- **涉及**：[triage-labels.md](agents/triage-labels.md#L7-L11)、[architecture.md](agents/architecture.md#L22)、[issue-tracker.md](agents/issue-tracker.md#L32-L33)
- **声明**：文档称仓库实际使用中文标签 `待评估`/`待补充`/`可接单-AI`/`待人工处理`/`不处理`；地图 Issue 使用 `wayfinder:map`、`wayfinder:<type>` 标签。
- **现状**：`gh label list` 实际为英文名 `needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix`（仅描述是中文），线上**无任何**中文标签和 `wayfinder:*` 标签。即线上标签名与 skill 角色名完全相同（恒等映射），文档映射表的目标标签全部不存在。Agent 按文档执行 `gh issue edit --add-label "待评估"` 会直接报错。
- **选项**：A. 调整文档——triage-labels.md 映射表右列改为英文标签名；wayfinder 标签段标注「使用前需先创建」｜ B. 修正线上——在 GitHub 创建中文标签与 `wayfinder:*` 标签
- **初步建议**：A（映射表本身就是为标签改名设计的，改右列成本最低）
- **决策**：☑ 调整文档 ☐ 修正 GitHub ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/agents/triage-labels.md`、`docs/agents/architecture.md`、`docs/agents/issue-tracker.md`；triage 映射右列改为英文标签，wayfinder 段标注使用前需先创建 `wayfinder:*` 标签。

### D02 IPC 输入校验声明失实（安全相关）⚠️

- **涉及**：[architecture.md](agents/architecture.md#L17)
- **声明**：「IPC 输入在 main process 校验」。
- **现状**：main 进程 4 个 IPC domain（`apps/desktop/src/main/domains/{app,browserProfiles,runtime,update}/ipc.ts`）无任何 schema/zod 校验；`RuntimeIpcService.call` 收到 method+input 后直接转发 backend（`apps/desktop/src/main/domains/runtime/ipc.ts:15-21`）。backend 侧 zod 校验仅零星几处（如 `app-control/localControlServer.ts`），无统一 RPC 输入校验层。
- **选项**：A. 调整文档——如实改为「IPC 由 preload 最小暴露面约束，输入由 backend 模块按需校验」｜ B. 修正代码——在 main 或 backend 补统一输入校验（若认为「渲染层被攻破后可任意调 RPC」是需要防御的威胁模型）
- **初步建议**：先 A 如实描述；B 作为独立安全加固需求另行评估
- **决策**：☐ 调整文档 ☑ 修正代码 ☐ 其他：＿＿＿
- **处理结果**：已由 `security/ipc-hardening` 分支按 B 修正代码。preload 只暴露 `process.platform` 与受限 `ipcRenderer`（`invoke/on/removeListener`），channel 白名单来自 `@ant-chat/shared` 的 `APP_IPC_CHANNEL_NAMES`、`IPC_RENDERER_EVENT_NAMES`；main 侧新增 `apps/desktop/src/main/utils/ipc-validation.ts` 并接入 `runtime/app/update` 三个 IPC domain；`docs/agents/architecture.md` 的「安全与配置」已同步（该文件被 `.gitignore` 忽略，修改保留在本机工作区）。

### D03 desktop renderer 目录不存在、「共享」方向写反、dev.db 旧文件名残留

- **涉及**：[architecture.md](agents/architecture.md#L8-L9)、[architecture.md](agents/architecture.md#L16)
- **声明**：`src/renderer/`：React UI；`apps/web/`「共享 desktop renderer 代码」；`dev.db` 视为本地开发数据。
- **现状**：
  - `apps/desktop/src/` 下只有 `main`、`preload`、`types`，无 renderer；React UI 全部在 `apps/web/src/`；desktop 的 electron-vite 渲染层直接以 `../web` 为 root（`apps/desktop/electron.vite.config.ts:9` `webRoot = resolve('../web')`）。是 desktop 复用 web 渲染层，方向与文档相反。[release-guide.md](release-guide.md#L52) 已如实描述该结构。
  - 全仓无 `dev.db` 引用；实际数据库文件名为 `ant-chat.db`（`packages/backend/src/paths.ts:26`）。
- **选项**：基本只有 A——调整文档（结构与文件名均对齐现状）
- **决策**：☑ 调整文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/agents/architecture.md`：移除不存在的 `src/renderer/`，改为 desktop 复用 `apps/web` 渲染层，`dev.db` 改为 `ant-chat.db`。

### D04 testing.md 测试文件模式声明会产出永不执行的测试

- **涉及**：[testing.md](agents/testing.md#L14-L17)
- **声明**：「各包/app 有独立的 vitest.config.ts」；「测试文件：`*.test.ts` / `*.test.tsx` / `*.spec.ts` / `*.spec.tsx`」；「当前覆盖率范围包含 packages 和 apps 模块」。
- **现状**：
  - 仅 4 份 vitest.config.ts（apps/web、apps/desktop、packages/backend、packages/shared）；packages/ant-chat 与 packages/control-client 有 `test` 脚本但用 vitest 默认配置，packages/ui 无 test 脚本；
  - 仓库实际 **0 个** `.test.*` 文件（175 个 `.spec.ts` + 51 个 `.spec.tsx`），4 份 config 的 include 均只配 `**/*.spec.{ts,tsx}`（如 `apps/web/vitest.config.ts:10`）——按文档写 `.test.ts` 测试**永远不会被执行**；
  - `packages/ui` 不在 `pnpm -r test` 执行范围。
- **选项**：A. 调整文档——改为「仅 `*.spec.{ts,tsx}`；config 见以下 4 份；ui 包暂无测试」｜ B. 修正代码——4 份 config 的 include 补 `.test.*`（现状无此类文件，收益存疑）
- **初步建议**：A
- **决策**：☑ 调整文档 ☐ 修正代码 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/agents/testing.md`：测试文件仅为 `*.spec.{ts,tsx}`，列出 4 份 vitest 配置，说明 `packages/ui` 无测试脚本；D19 一并处理。

### D05 release-guide.md 自相矛盾：npm pack vs pnpm pack

- **涉及**：[release-guide.md](release-guide.md#L214) 与 [release-guide.md](release-guide.md#L235)
- **声明**：第 214 行「使用 `npm pack` 生成唯一 tarball」；第 235 行又警告「不要用 `npm pack` 打包含 `catalog:` 引用的包」。
- **现状**：workflow 实际用 `pnpm pack`（`.github/workflows/release-npm.yml:56`）；第 214 行是笔误，与第 235 行内部矛盾。
- **决策**：☑ 调整文档（214 行改为 `pnpm pack`）☐ 其他：＿＿＿
- **处理结果**：已改 `docs/release-guide.md`：第 214 行与第 247 行的 `npm pack` 统一为 `pnpm pack`，第 235 行的反向警告保留。

### D06 visualize 计划的安全合同与实现相反（inline `on*`）

- **涉及**：[ant-chat-integration-plan.md](plan/visualize-skill/ant-chat-integration-plan.md#L35)
- **声明**：fragment 校验「拒绝 inline `on*` 属性」。
- **现状**：实现**允许** inline `on*` 事件属性——工具描述明示「可包含……inline on* 事件属性」（`packages/backend/src/agent-core/tools/publishVisualizationTool.ts:15`），测试断言 `onclick` 合法（`packages/shared/src/interfaces/__tests__/visualization.spec.ts:45`）；校验只拒绝宿主窗口/Electron/进程访问（`packages/shared/src/schemas/visualization.ts:144`）。这是实施时的有意反转（交互依赖 on*，但限制其仅可达 `antChatVisualization`）。
- **选项**：A. 调整文档——更新为实际安全合同（允许 on*，但仅可达 antChatVisualization）｜ B. 修正代码——回到拒绝 on* 的严格策略（会破坏现有交互能力）
- **初步建议**：A（实现有注释与测试自证是有意决策）
- **决策**：☑ 调整文档 ☐ 修正代码 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/plan/visualize-skill/ant-chat-integration-plan.md`：安全合同改为允许 inline `on*`，但仅可经 `window.antChatVisualization` 发送用户确认的 follow-up。

### D07 package-module-consolidation.md 三个「完成标准」已失真

- **涉及**：[package-module-consolidation.md](plan/package-module-consolidation.md#L45-L76)
- **声明**：完成标准称「保留 `@ant-chat/backend/rpc-handlers` 公开入口」「packages 只保留 backend、shared、local-server 和 ui」「Desktop 和 Local Server 仍只依赖 @ant-chat/backend」。
- **现状**：
  - backend exports 仅 `.` 与 `./package.json`（rpc-handlers 入口已由 commit `ca309ebf` 移除）；
  - `local-server` 已改造为 npm 产品包 `ant-chat`，另新增 `@ant-chat/control-client`（现 5 包）；
  - desktop 依赖 backend + control-client + shared（`apps/desktop/package.json:41-43`），ant-chat 同样依赖三者；
  - 「agent-core、data、mcp 不得互相反向依赖」（:45）：生产代码合规，仅 codex live 测试文件 import data（`agent-core/ai-providers/codex/__tests__/live.spec.ts:8-10`）——测试文件是否受该约束，文档未明确。
- **选项**：A. 调整文档——加「已实施（历史记录，完成后包结构继续演进，终态见 README）」状态头注｜ B. 逐条改写正文
- **初步建议**：A（该文档全部步骤已勾选 [x]，本质是历史记录）
- **决策**：☑ 调整文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/plan/package-module-consolidation.md`：增加「已实施（历史记录）」状态头注，并把完成标准标为合并时点；未逐条改写正文。

---

## 二、中影响决策项（D08–D18）

### D08 ai-sdk-v7 升级计划：已完成合入但文档仍呈「进行前」状态

- **涉及**：[ai-sdk-v7-upgrade-plan.md](ai-sdk-v7-upgrade-plan.md#L3-L4)
- **现状**：升级已落地——catalog `ai: ^7.0.18`（pnpm-workspace.yaml），provider 包已升（`packages/backend/package.json:39-42`），commit `ac16c9b2`「升级 AI SDK 至 v7 并重构 MultiProvider 实现」已合入，multi-provider.ts 与计划 2.3 节方案逐条吻合（`ModelMessage`、`result.stream:263`、`instructions:251`、单一 usage 来源）。分支 `refactor/ai-sdk-v7-upgrade` 已不存在。
- **次要偏差**：文档称「ci.yml 用 node 22」——实际矩阵 `[22, 24]`（`ci.yml:20`）；`LanguageModelUsageSchema` 行号漂移（实际 `messages.ts:244`）。
- **选项**：A. 加「已实施（2026-10 合入，ac16c9b2）」状态头注，正文保留为迁移方案记录｜ B. 归档/删除
- **决策**：☑ 调整文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/ai-sdk-v7-upgrade-plan.md`：增加「已实施（2026-10 合入，ac16c9b2）」状态头注，并修正 `LanguageModelUsageSchema` 行号与 CI Node 矩阵（22/24）。

### D09 message-channels 三份文档：已实施未标注 + 接口/命令/字段演进未回写

- **涉及**：[backend-interfaces](plan/message-channels-backend-interfaces.md)、[data-model](plan/message-channels-data-model.md)、[implementation-handoff](plan/message-channels-implementation-handoff.md)
- **现状**：三份描述的设计已全部落地（`packages/backend/src/channels/` 全套、四张表 `schema.ts:96-134`、设置页 `apps/web/src/pages/Settings/Channels.tsx`、feishu/weixin 目录完整），但：
  1. 控制命令实际为十种——新增 `/mode`（`channelCommandParser.ts:20`），文档均列九种；
  2. 「建议能力集合」中的 `channel.update` 不存在，实际为 create/delete/enable/disable + `channel.listPairings`/`channel.revokePairing`（`app-control.ts:165-168`）；
  3. `ChannelConnector` 实际多 `sendAttachment` 出站附件方法（`channelConnector.ts:134`）；
  4. channel_accounts 实际多 `owner_user_id`、`permission_mode` 字段（`schema.ts:101,103`）；
  5. data-model 状态标注仍停在「已确认，供后续实施会话执行」；
  6. handoff 称微信「等待真实 iLink 扫码联调」——联调当前进度需你确认。
- **选项**：A. 三份加「已实施」头注，正文差异点同步现状｜ B. 只加头注，正文作为设计快照保留
- **决策**：☑ 调整文档（含差异回写）☐ 调整文档（仅头注）☐ 其他：＿＿＿；微信联调实际状态：待确认（无代码留痕，**无法本地验证**）
- **处理结果**：三份文档均加「已实施」头注；回写 `/mode`、实际 ChannelConnector 接口（含 `sendAttachment`）、AppControl 实际能力集合、`owner_user_id`/`permission_mode` 字段。微信真实 iLink 联调状态保持「待确认」。

### D10 message-list-trace-refactor.md：bash 演进导致多处引用失效

- **涉及**：[message-list-trace-refactor.md](message-list-trace-refactor.md#L12-L150)
- **现状**（均为 bash→execute_command、browser 拆分等后续演进所致）：
  - `bash` 工具已改名 `execute_command`（`commandTool.ts:67`）、`browser` 已拆为 12 个 `browser_*` 子工具、另有新增 `send_attachment`/`read_command_output`/`kill_command`（:13）；
  - `bashTool.ts:15` → 实际 `commandTool.ts:25`（:105）；`BashToolInput` → `CommandToolInput`（:103,141）；`bashRunner.ts:160` → `commandRunner.ts:163`（:16）；`parseBashResult` → `parseCommandResult`（`toolDisplay.ts:183`）（:143）；
  - **需单独判断**：文档称「`ToolResultContent.result` 始终是字符串」（:12），schema 现已放宽为 `z.unknown()`（`messages.ts` ToolResultContentSchema）——是演进后的有意放宽还是遗漏？；
  - **可能补测试**：文档称 nativeToolService.spec 增加「bash schema 含 description 断言」（:150），实际该 spec 无此断言（command/__tests__/ 下也未找到）。
- **决策**：☑ 调整文档（历史引用更新）☐ 修正代码（补 result 字符串约束/补测试断言）：＿＿＿
- **处理结果**：已改 `docs/message-list-trace-refactor.md`：更新 `execute_command`、`browser_*`、`commandTool`/`commandRunner`/`parseCommandResult` 等引用，并标注现状。`ToolResultContent.result` 现状为 `z.unknown()`，「有意/遗漏」**待确认（无法本地验证）**；`nativeToolService.spec` 的 description 断言未补，已在文中注明。

### D11 feishu 调研文档：声明的 5 个「缺口」已有 4 个被修复

- **涉及**：[feishu-card-usage-patterns.md](research/feishu-card-usage-patterns.md#L18-L676)
- **现状**：
  - :18「channels 目录未提交、未跟踪」——已全部提交跟踪（commit `77b841af`）；
  - :537「RegisteredAction 未绑定 externalUserId」——已绑定（`channelDelivery.ts:53,73,153`，复验比对 ：192）；
  - :676「无 cancel action，不能停止任务」——已有 `task.cancel`（`channelDelivery.ts:46,473-474`）；
  - :640「selectModel 不发 conversation:updated 事件」——现走 `deps.updateConversation` → `conversationLifecycle.update` 发事件（`channelRuntime.ts:170` 等、`conversationLifecycle.ts:157-160`）；
  - :674「task.summary/errorMessage 未入 projection」——已写入（`channelDelivery.ts:290-292`）；
  - :642「一模型一按钮」——已改 form+select_static+submit（`feishu/card.ts:17-38`）；
  - 另多处 file:line 行号漂移、审批复验已迁移至 `channelActionHandler.ts`。
- **选项**：A. 在文档头部加「快照时点：2026-09 前，部分缺口已修复（见文末更新记录）」并附修复清单｜ B. 逐段更新
- **决策**：☑ 调整文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/research/feishu-card-usage-patterns.md`：头部标注快照时点，文末新增「实现更新记录」列出已修复缺口；仍待确认 action token 跨重启持久化。

### D12 hermes 调研文档：「现状与差距」表与自身「实施状态」矛盾

- **涉及**：[hermes-weixin-delivery-patterns.md](research/hermes-weixin-delivery-patterns.md#L169-L206)
- **现状**：:169-184 差距表（无上限直发/无块拆分/无折行/失败整体抛错）描述的是实施前状态，而 :196-206 已声明「建议 1-5 已落地（2026-08-08）」，代码确已实现（`weixin/delivery.ts` 四函数、`connector.ts:103-128` 拆分逐条发送、`transport.ts:251-255` 限流退避）。表格未标注快照时点，按现状读会产生误解。
- **决策**：☑ 调整文档（差距表标注「实施前快照」）☐ 其他：＿＿＿
- **处理结果**：已改 `docs/research/hermes-weixin-delivery-patterns.md`：差距表标题改为「实施前现状与差距（快照）」，并注明建议 1-5 已于 2026-08-08 落地。

### D13 code.md Ant Design 迁移规则已成历史

- **涉及**：[code.md](agents/code.md#L14-L16)
- **声明**：「渲染层避免引入新的 ant-design 依赖……触及现有 Ant Design 组件时迁移到 shadcn/ui」。
- **现状**：渲染层已**无任何** antd/@ant-design 依赖与 import（全局搜索零命中）；UI 栈为 shadcn（`packages/ui/package.json:38`）+ `@base-ui/react`。「现有 Ant Design 组件」已不存在，迁移已完成。
- **选项**：A. 改写为防回归规则（「禁止引入 antd；历史上曾用并已迁移完毕」）｜ B. 删除该节
- **决策**：☑ 调整文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/agents/code.md`：UI 节改为防回归规则（禁止 antd / `@ant-design/*`，历史迁移已完成）。

### D14 ui-standards.md 引用的 DESIGN.md 不存在

- **涉及**：[ui-standards.md](ui-standards.md#L4)
- **声明**：「设计方向：Kami 纸感（详见 `apps/web/DESIGN.md`）」。
- **现状**：全仓无 DESIGN.md（find 零命中）。其余 UI 组件/主题/Tailwind v4 声明全部验证符合。
- **选项**：A. 调整文档——删除引用或改为内联描述｜ B. 补建 apps/web/DESIGN.md（若设计文档本应存在）
- **决策**：☑ 调整文档 ☐ 补建设计文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/ui-standards.md`：删除 `apps/web/DESIGN.md` 引用，改为内联的 Kami 纸感描述；未新建 DESIGN.md。

### D15 background-command-execution.md 三处细节偏差

- **涉及**：[background-command-execution.md](plan/background-command-execution.md#L213-L234)（文档已标「已实现 2026-10-05」）
- **现状**：
  - :213 面板实际挂载于 `Sender.tsx:78`（SenderComposer 之外的兄弟节点），非文档所述「放在 SenderComposer 中」；
  - :217 实际面板只保留 running 命令，终态走 TurnTrace 徽标（`BackgroundCommandPanel.tsx:26,34-37`，注释自述有意取舍）；
  - :228/:234 同一段「就近可见性」文字重复出现两次（编辑残留）。
- **决策**：☑ 调整文档（同步实际落点 + 清理重复段）☐ 修正代码（面板按文档移入 composer 卡片）：＿＿＿
- **处理结果**：已改 `docs/plan/background-command-execution.md`：面板落点改为 `Sender.tsx:78` 的兄弟节点；说明只保留 running 命令、终态走 TurnTrace；删除重复的「就近可见性」段。

### D16 visualize 计划其余三处过时

- **涉及**：[ant-chat-integration-plan.md](plan/visualize-skill/ant-chat-integration-plan.md#L30-L61)（除 D06 外）
- **现状**：
  - :30-31「next-turn user message」语义已随 pending 队列 D5 移除（全仓 `nextTurn` 零匹配，`SKILL.md:90` 已改述）；
  - :37 `font-src 'none'` 重复两次（笔误）；CSP 实际更全面（`sandbox.ts:3`）；
  - :61 验收命令 `pnpm --filter ant-chat test -- src/components/Visualization`——该路径属 `@ant-chat/web` 而非 ant-chat 包，命令无法命中；
  - 文档整体无状态标注。
- **决策**：☑ 调整文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/plan/visualize-skill/ant-chat-integration-plan.md`：移除 `next-turn` 特殊语义，修正重复的 `font-src` 并同步完整 CSP，验收命令改为 `@ant-chat/web`，增加已实施状态标注。

### D17 git-workflow.md 未反映 CI 强制 changeset 门禁与 pre-release 模式

- **涉及**：[git-workflow.md](agents/git-workflow.md#L15)
- **现状**：CI 对 PR **强制**运行 `node scripts/validate-changeset.mjs`（`ci.yml:52-54`，仅 PR + Node 22）；`.changeset/pre.json` 存在（mode: pre，tag: alpha）——`version-packages` 行为受 pre 模式影响。文档全节未提，也未链接已覆盖这些内容的 [release-guide.md](release-guide.md)。
- **决策**：☑ 调整文档（补一段「CI 强制 changeset 覆盖检查 + 当前处于 alpha pre 模式，详见 release-guide」）☐ 其他：＿＿＿
- **处理结果**：已改 `docs/agents/git-workflow.md`：补充 PR changeset 强制检查、Node 22/24 矩阵、`.changeset/pre.json` alpha pre 模式，并链接 `release-guide.md`。

### D18 release-guide.md 其余小项

- **涉及**：[release-guide.md](release-guide.md#L110-L189)
- **现状**：
  - :110 引用「ci.yml:35」——changeset 检查实际在 `ci.yml:52-54`（行号漂移）；且 CI 矩阵为 `[22, 24]`，`pnpm check` 两个版本都跑；
  - :47「@workspace-ui」笔误——实际包名 `@workspace/ui`；
  - :110、:171、:189 三处 Markdown 链接使用维护者本机绝对路径，其他克隆环境不可用，应改仓库相对路径。
- **决策**：☑ 调整文档 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/release-guide.md`：`@workspace-ui` → `@workspace/ui`；三处本机绝对路径改为 `../.github/...` 相对链接；changeset 检查行号改为 52-54 并说明 Node 22/24 矩阵。

---

## 三、低影响 / 待定项（D19–D24）

### D19 testing.md「覆盖率范围包含 packages 和 apps」表述模糊

- **现状**：`pnpm test:unit` = `pnpm -r test`；测试文件分布为 backend 124、web 84、shared 8、desktop 5、ant-chat 3、control-client 2、**ui 0**——packages/ui 无 test 脚本不在范围。「包含」未说明全部/部分。
- **决策**：☑ 调整文档（明确范围）☐ 给 ui 包补 test 脚本 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/agents/testing.md`：明确 `pnpm test:unit` = `pnpm -r test`，`packages/ui` 无 test 脚本、不在范围。

### D20 code.md 两条表述与实际约束来源不符

- :6「缩进/LF 遵循 `.editorconfig`」——.editorconfig 规则段仅 `[*.{js,css}]`，不覆盖 ts/tsx/md；实际约束来自 `@antfu/eslint-config` stylistic 规则；
- :7「文件 kebab-case（如适用）」——packages/ui 为 kebab-case，但 `apps/web/src/pages/Settings/About.tsx` 等页面组件为 PascalCase，两风格并存，「如适用」边界未定义。
- **决策**：☑ 调整文档（改为「遵循 eslint stylistic；组件文件 PascalCase、工具/样式 kebab-case」等明示边界）☐ 统一文件命名（改动面大）☐ 扩展 .editorconfig：＿＿＿
- **处理结果**：已改 `docs/agents/code.md`：说明 `.editorconfig` 只覆盖 js/css，TS/TSX/Markdown 由 `@antfu/eslint-config` stylistic 规则约束；文件命名改为「跟随所在目录既有约定」并给出两类示例。

### D21 ADR-0001 / ADR-0002 历史快照与现实语义的补充注记

- ADR-0001:172「Bash 允许单个命令或 `&&`」——现状：管道/重定向/分号等「无法结构化授权」的语法不硬阻断，走单次审批后原样执行（`bashCommandParser.ts:209-232`）；硬阻断仅限子 shell、命令替换等 unverifiable 结构（:791-834）。若「允许」指结构化授权范围则成立，指执行范围则现状更宽松。local-review:46 的表述与代码一致，可作补充解读；
- ADR-0002:32 browser_navigate 参数表缺 `injectCookies`/`timeoutMs`（`browserTool.ts:86-92`，injectCookies 由 ADR-0003 引入，两 ADR 自洽）——决策时点快照，倾向不改。
- **决策**：☑ 补「现状注记」段 ☐ 保持历史快照不动：＿＿＿
- **处理结果**：已在 ADR-0001 的 Bash 边界段、ADR-0002 的 browser 参数表后补「现状注记」，说明执行层放宽与 `injectCookies`/`timeoutMs` 现状。

### D22 local-review.md 代码摘录已失真（历史评审记录）

- **涉及**：[tool-approval-rules-local-review.md](tool-approval-rules-local-review.md#L32-L42)
- **现状**：`runPreparedBashTool()` + `spawn(cmd, { shell: true })` 的摘录已过时——现为 `runPreparedCommand`（`commandRunner.ts:25`）+ `spawn(executablePath, args, { shell: false })`（:44-58）+ 固定解释器一次执行（`bashCommandAdapter.ts:94-99`，来自 commit `9435b68a`）。**结论本身（单 shell 一次执行）仍成立**，仅函数名与摘录失真。
- **选项**：该文档是 2026-07-26 时点的本地评审记录——A. 加一行「代码已重构，结论仍成立，摘录见历史」注记｜ B. 不动（历史记录性质）
- **决策**：☑ 加注记 ☐ 保持不动 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/tool-approval-rules-local-review.md`：在代码摘录后补现状注记，说明已重构为 `runPreparedCommand` + `spawn(..., { shell: false })`，结论仍成立。

### D23 domain.md 目录示意含 `src/`（低置信度观察）

- **涉及**：[domain.md](agents/domain.md#L22)——文件结构示意画有根目录 `src/`，本仓库根无 src/（实际 apps/ + packages/）。属 single-context 布局的通用模板示意，非对本仓库的声明，可能无需处理。
- **决策**：☐ 调整文档（示意对齐本仓库）☑ 保持不动
- **处理结果**：未改 `docs/agents/domain.md`。该 `src/` 是 single-context 布局的通用模板示意，不是对本仓库目录的声明，保持原样。

### D24 tooling.md「必须等待所有子代理完成」与环境实际机制有张力

- **涉及**：[tooling.md](agents/tooling.md#L23)
- **声明**：「必须等待所有子代理完成后再返回结果」。
- **现状**：dim CLI 环境的子会话创建工具（`lody_session_create` 等）是**异步 durable 模式**——官方用法是「结束回合，结果批量送达，不要轮询」；仅 workflow 内的 `api.agent` 是阻塞等待。本次审查即出现过实例：一次 session_create 调用超时报错，实际操作在后台完成并异步送达结果。文档的「必须等待」若被理解为「阻塞轮询」与实际机制相反。
- **选项**：A. 调整文档——改为「等待子代理结果返回后再汇总结论；durable 异步任务则结束回合等待送达，不轮询」｜ B. 保持不动（作为行为意图而非执行方式）
- **决策**：☑ 调整文档 ☐ 保持不动 ☐ 其他：＿＿＿
- **处理结果**：已改 `docs/agents/tooling.md`：改为「汇总结论前等待子代理结果返回；durable 异步子会话结束回合等待送达，不阻塞轮询」。

---

## 四、完全符合现状的文档（10 个，无需处理）

| 文档 | 结论摘要 |
| --- | --- |
| [agents/communication.md](agents/communication.md) | 纯行为规范，无可证伪项 |
| [agents/execution.md](agents/execution.md) | 纯行为规范，无可证伪项 |
| [agents/tooling.md](agents/tooling.md) | rg/fd/gh 均已安装可用 |
| [agents/domain.md](agents/domain.md) | CONTEXT.md、docs/adr/ 均存在（除 D23 示意项） |
| [adr/0003-browser-auth-state-import.md](adr/0003-browser-auth-state-import.md) | macOS-only、双路径查找、AES-256-GCM、0600/0700、generation 懒注入等全部逐条验证一致 |
| [adr/agent-tool-permission-architecture.md](adr/agent-tool-permission-architecture.md) | scope 四值、operationType、AutomationRun 状态机、deny 优先 fail-closed 全部一致 |
| [adr/tool-approval-whitelist-architecture.md](adr/tool-approval-whitelist-architecture.md) | 已被 ADR-0001 取代的状态与代码互相印证，自洽 |
| [plan/pending-message-queue-backend.md](plan/pending-message-queue-backend.md) | 决策、实现定案、后续调整与代码逐项吻合，且已标注「已实现」——**8 份计划中维护最好的一份** |
| [plan/image-generation.md](plan/image-generation.md) | 实现落点表与代码一一对应，未完成项（真机验证）已如实自标 |
| [image-recognition.md](image-recognition.md) | 全部 11 处路径/机制声明验证通过 |

另：[adr/0001](adr/0001-tool-approval-rules.md)、[adr/0002](adr/0002-browser-tool-split-and-rule-kind.md)、[release-guide.md](release-guide.md) 主体与现状一致，不符处见 D05/D18/D21。

## 五、无法本地验证的声明（供知情，非不符）

1. issue-tracker.md:34 —— GitHub issue dependencies API 端点已验证真实存在（docs.github.com/en/rest/issues/issue-dependencies，WebSearch 核实）；仍无法验证的是本仓库 sub-issues 功能开关是否启用（仓库级 GitHub 设置）；
2. release-guide.md:206「安装包未签名」—— electron-builder `notarize: false` 已核实，但实际签名证书状态无法在仓库内验证；
3. release-guide.md:235「pnpm pack 展开 catalog:」—— pnpm 工具行为，未实际执行 pack；
4. image-generation.md「真机验证未完成」—— 需真实 ModelScope token；
5. handoff:80 微信 iLink 联调当前进度 —— 无代码留痕（见 D09）；
6. research 两文档引用的外部仓库（hermes 本机路径已不存在、lark-coding-agent-bridge）与飞书/微信官方 API 合同 —— 按外部调研材料处理；
7. ADR-0003 四种浏览器 Profile 自动发现的目录布局兼容完整度 —— 仅核对了导入器错误文案中的浏览器名称。

## 六、审查方法与可信度说明

- 4 个并行子代理分组核对（agents / ADR+发布 / plan / 专题+调研），主会话独立复核全局基线（包结构、scripts、vitest 配置、GitHub 标签、release workflow、AI SDK 版本与合入记录）；
- agents 组另有第二个独立子代理复核（同一任务两次执行）：11 项发现中 10 项与首轮重合，唯一新增项已合并为 D24；两轮结论在 renderer 缺失、标签失效、vitest 配置、CI changeset 门禁等关键点上完全一致，交叉验证了首轮结论可信度；
- 高影响发现（renderer 缺失、ant-chat.db、pnpm pack 矛盾、on* 反转、externalUserId、/mode、DESIGN.md、channels 已跟踪、IPC 无校验）均经主会话二次抽查，全部属实；
- 行号类证据以 2026-10-15 工作区为准，后续代码演进会使部分行号漂移——决策落地时如需精确行号请以文档内链接跳转后核对。
