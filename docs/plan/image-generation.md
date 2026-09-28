# 图像生成能力（ModelScope 生图集成）

> 状态：**已实现（2026-09-28），真机验证进行中**。接口事实为 2026-09-23 实测；
> 代码覆盖实现顺序 1~6、8（见文末「实现落点」）；生图链路已真机跑通，
> 验证中发现的两处交付缺陷已修复（见文末「修复记录」）。
> 2026-09-26 评审修订：CLI 不再暴露模型参数（模型一律提前配置）；产物目录由 CLI 显式传递；
> 超时由调用方决定、无系统默认值；**产物交付改为 agent 显式转发（`send_attachment`），
> 删除原方案的自动认领机制**。
>
> 关联：[图像识别能力](../image-recognition.md)（该文档的「边界（明确不做）」里写死过"图像生成不做"，本次是打开这个边界）

## 背景与决策

现状只有**识别**（看图→文本）。用户提出把 ModelScope（魔搭）作为服务商接入，新增**生成**能力，
后续还要接生视频，以及 OpenAI、字节等其它厂商的生图模型。

用户拍板的决策：

1. 生图模型清单 = **内置精选 + 允许手填 model id**（不依赖非官方目录接口）
2. CLI **阻塞等待到完成**（与 `image recognize` 一致，agent 一次调用拿结果）
3. 产物交付走 **agent 显式转发**：CLI 落盘并在 `--json` 返回 `files[].path`，
   SKILL 教 agent 用 `send_attachment(path)` 把图发给用户（见 3.5）；
   工作区文件同时保留（2026-09-26 评审修订，路线演变见下）
4. Provider 语义升级：从「语言模型服务商」→「**模型服务商**」，一家厂商可同时提供
   chat / 生图 / 生视频多种能力
5. 超时**由调用方决定，无系统默认值**：socket 层不再写死 120s，也不设命令级默认；
   调用方 `--timeout` 显式设置（同时约束 CLI 响应等待与后端总超时），未设置时由
   外层调用者兜底（agent 的 `execute_command timeoutMs` / 人工 Ctrl-C），配合断连
   abort（见「四」）停止后端
6. CLI 断连（超时自杀 / Ctrl-C / 进程被杀）**传播为 AbortSignal**，停止后端轮询，
   避免额度白扣（见「四」）
7. **CLI 不暴露模型参数**：生图模型一律提前在设置页配置（含手填 model id），
   `image generate` 不提供 `--provider-id/--model-id`
8. **产物目录由 CLI 显式传递**：`--output` 显式指定，后端不做 workspace 默认推导

> 决策 3 的路线演变（完整记录，供后续复盘）：
>
> 1. **初版**：排除「agent 用 `send_attachment` 转发」（依赖 LLM 主动性，不可靠），
>    定为「进程内归属 + 自动认领附加」——GenerationModule 登记产物、
>    `execute_command` 结束时按 stdout 路径认领、合并进 outputBlocks。
> 2. **评审第一轮**：提出 native tool `generate_image` 直连方案（复用 `send_attachment`
>    的 outputBlocks 注入模式），可整体消除 registry、认领与取消长链；当时按 CLI 路径
>    保留为备选。
> 3. **评审第二轮（定案）**：三个候选——native tool（系统保证附加，需新增工具与
>    权限语义）、CLI + registry 自动认领（系统保证，机制最多）、CLI + agent 显式转发
>    （零新增机制，转发依赖 LLM）。**选定显式转发**：`send_attachment` 全链路现成
>    （附加、频道分流、体积校验），产物本就落盘 workspace、`path` 直接可用；
>    接受的代价是「LLM 忘记转发则图不出现」，靠 SKILL 教学与输出提示缓解（见 3.5、五）。
>
>    file_id 变体（CLI 返回附件 file_id 而非 path）被否：需要产物预写入附件存储的
>    新接口 + `send_attachment` 改造，而产物已在文件系统、path 零成本——与
>    「零新机制」的初衷矛盾。（对比：`image recognize` 的 `fileId` 是**输入**方向，
>    用于读不在文件系统的聊天附件；生图产物在文件系统，无此需求。）

## 一、现状：扩展点在哪

现有图像能力只有识别，走 chat 多模态：

- [`ImageModule.recognize`](../../packages/backend/src/app-runtime/modules/image/index.ts#L57-L88)
  → `aiProviderFactory.streamModel`，输入 `{type:'image'}`，输出文本
- 设置项只有视觉模型（[appSettings.ts](../../packages/shared/src/schemas/appSettings.ts#L44-L48)），
  UI 按 `inputModalities` 含 `image` 过滤
- CLI 只有 `ant-chat image recognize`（[commands/index.ts](../../packages/control-client/src/commands/index.ts#L424-L458)）
- SKILL 只有 `image-recognition`

服务商抽象已预留位置，但**没有生成通道**：

| 现状 | 位置 |
|---|---|
| Integration 注册表（新增厂商只需追加 entry） | [register-modules.ts](../../packages/backend/src/app-runtime/register-modules.ts#L41-L49) |
| `ProviderIntegration` 接口，只有 `createAIProvider`（LLM 推理） | [providerIntegration.ts](../../packages/backend/src/app-runtime/modules/provider/providerIntegration.ts#L31-L50) |
| 新增 Integration 的模板（Codex：固定 endpoint + 自有 client） | [codexIntegration.ts](../../packages/backend/src/app-runtime/modules/provider/codexIntegration.ts) |
| `outputModalities` 已定义含 `image`/`video`，注释「当前无运行时消费方」 | [providerConfigModels.ts](../../packages/shared/src/schemas/providerConfigModels.ts#L53-L66) |
| 产物交付：工具 outputBlocks → 消息附件（现有路径，**生图交付直接复用，零新增**） | [sendAttachmentTool.ts](../../packages/backend/src/agent-core/native-tools/tools/sendAttachmentTool.ts#L23-L60) |
| 模型落库与「同步模型」流程 | [providerSettingsRepository.ts](../../packages/backend/src/data/settings/providerSettingsRepository.ts#L293-L341)、[ModelList.tsx](../../apps/web/src/components/ProviderManage/ModelList/ModelList.tsx#L54) |

## 二、ModelScope 接口事实（实测）

Base：`https://api-inference.modelscope.cn/v1`

| 探测 | 结果 |
|---|---|
| `GET /v1/models` | 200，35 个模型，**全是 chat**（无 `Qwen/Qwen-Image`） |
| `POST /v1/images/generations` | 401（端点存在，需 token） |
| `GET /v1/tasks/{id}` | 401（端点存在） |
| `POST /v1/videos/generations` | 401（**路由存在**，参数未验证） |

生图调用形态（官方示例 + 第三方实现一致）：

```http
POST /v1/images/generations
Authorization: Bearer <token>
X-ModelScope-Async-Mode: true
X-ModelScope-Task-Type: image_generation

{ "model": "Qwen/Qwen-Image", "prompt": "...", "size": "1024x1024",
  "negative_prompt": "...", "steps": 50, "guidance": 4.0, "seed": 42 }
→ { "task_id": "..." }
```

```http
GET /v1/tasks/{task_id}
X-ModelScope-Task-Type: image_generation
→ { "task_status": "SUCCEED", "output_images": ["https://..."] }
```

其它发现：

- **`/v1/models` 不能当生图目录**：只列 chat 模型，生图模型不在其中。
- **社区目录接口可用但非官方**：`PUT https://modelscope.cn/api/v1/dolphin/models`
  按 `text-to-image-synthesis` 筛返回 **58381 条**（含海量 LoRA），但 `SupportApiInference`
  字段返回 `False` 不可信、接口未文档化 → 本期不依赖（用户决策 1）。
- **models.dev 已有 `modelscope` provider**（7 个 chat 模型：GLM-4.5/4.6、Qwen3 系列）
  → chat 部分可直接复用现有 `api-key` 通道与 models.dev 模型源。
- **额度**：多个二手来源称每日 2000 次（全模型合计）+ 单模型额度；
  官方文档站是 SPA 抓不到原文，**未经官方确认**。
- 第三方参考实现（`tiezhu-modelscope-api-inference`）轮询间隔 2s、超时 180s，
  状态词表 `succeed/success/completed/done` 与 `failed/error/canceled`。

## 三、设计

### 3.1 Provider 泛化为「模型服务商」

`ProviderIntegration` 增加与 `createAIProvider` 平行、**按能力分类**的可选通道：

```ts
export interface ProviderIntegration {
  // ...现有字段
  createAIProvider?: (provider: ProviderConfigSchema) => Promise<IAIProvider>
  /** 生成类能力通道；未实现的能力不声明，调用方 fail closed。 */
  mediaGeneration?: Partial<Record<MediaKind, MediaGeneratorFactory>>
}

type MediaKind = 'image' | 'video'
type MediaGeneratorFactory = (provider: ProviderConfigSchema) => MediaGenerator
```

```ts
export interface MediaGenerationRequest {
  model: string
  prompt: string
  /** 目标尺寸（像素）。通用接口用数字对，厂商格式（如 ModelScope 的 '1024x1024'）
   *  由 Integration 内部转换——接第二家厂商时尺寸表达分歧不再侵入调用方。 */
  width?: number
  height?: number
  negativePrompt?: string
  steps?: number
  guidance?: number
  seed?: number
  /** 产物落地目录（绝对路径），由调用方显式传入（CLI `--output`），后端必填校验、无默认。 */
  outputDir: string
  /** 总超时（ms）；未传时不主动超时，依赖 AbortSignal 取消（调用方决定超时，见「四」）。 */
  timeoutMs?: number
  signal?: AbortSignal
}
```

注意 `MediaGenerationRequest` **不携带 `kind` 字段**：generator 由
`Partial<Record<MediaKind, MediaGeneratorFactory>>` 按能力分类创建，实例自知种类；
请求再带 `kind` 存在不一致风险（`kind: 'image'` 打到 video generator）。

```ts
export interface MediaGenerationResult {
  providerId: string
  modelId: string
  /** 已下载到本地的产物 */
  files: Array<{ path: string, mediaType: string, bytes: number }>
  taskId?: string
  elapsedMs: number
}
```

关键约定：

- **异步协议（submit + poll）封在 Integration 内部**，对上层是带 `AbortSignal` 的 Promise。
  上层不需要知道 ModelScope 是异步的，也不需要知道 OpenAI 是同步的。
- **模型能力标识复用 `capabilities.outputModalities`**：含 `'image'` = 生图模型，
  含 `'video'` = 生视频模型。设置页与命令都按它过滤——与 `SelectVisionModel`
  按 `inputModalities` 过滤完全同构。
- 一家厂商的多条通道互不依赖：ModelScope 的 `mediaGeneration.image` 与
  `createAIProvider` 并存；未来 OpenAI/字节同理，只是换一个 Integration 实现。

### 3.2 ModelScope Integration

照 `codexIntegration.ts` 的结构新增 `modelscope`：

```ts
descriptor: { label: 'ModelScope', defaultApiMode: 'openai', fixedApiMode: 'openai' }
capabilities: {
  authentication: 'api-key',
  modelSource: 'provider',            // 自建模型源
  localAuthImport: false,
  usage: 'none',                      // 额度查询接口未知，不假装支持
  endpoint: 'fixed',
  fixedBaseUrl: 'https://api-inference.modelscope.cn/v1',
}
```

- `validateConfig`：拒绝非固定 baseUrl、非 openai wire protocol。
- `modelSource.listModels`：**models.dev 的 modelscope chat 模型 + 内置生图清单**合并。
  生图清单条目标 `capabilities.outputModalities = ['image']`，
  随现有「同步模型」按钮写入 models 表。
- `createAIProvider`：复用现有 `createProvider`（apiMode openai）。
- `mediaGeneration.image`：`ModelScopeAsyncImageGenerator`。
- 凭据：复用 `secretStore` 的 provider apiKey（API Key 路径已实现）。

内置精选清单（初版，**可用性待真机验证**）：

| model id | 用途 |
|---|---|
| `Qwen/Qwen-Image` | 文生图（主力） |
| `Tongyi-MAI/Z-Image-Turbo` | 文生图（快速） |

手填 model id 的闭环（决策 1 + 7）：手填发生在**模型管理的「添加模型」表单**
（[AddModelForm.tsx](../../apps/web/src/components/ProviderManage/ModelList/AddModelForm.tsx)），
当前表单只支持标注输入模态（`inputModalities`），**需增加「输出类型」标注**
（图片/视频），手动添加的生图模型才能带 `outputModalities` 进入生图选择器
（3.6 按该字段过滤）。CLI 侧不再提供模型参数，无库外透传路径。

图像编辑（`Qwen/Qwen-Image-Edit-2509` 等输入图 + 指令）参数形态与文生图不同，
本期不做，列入后续。

### 3.3 异步任务与轮询策略

| 参数 | 取值 | 说明 |
|---|---|---|
| 首次轮询延迟 | 3s | 避免提交后立刻空转 |
| 轮询间隔 | 3s（固定） | 官方示例 5s、第三方 2s，取中 |
| 单次请求超时 | 30s | 覆盖提交与每次状态查询 |
| 产物下载超时 | 60s | 产物 URL 下载独立计时，不与轮询共享 |
| 总超时 | **无默认**，`timeoutMs` 由调用方传入（CLI `--timeout` 透传） | 未传时不主动超时，依赖 AbortSignal 取消（决策 5） |
| 取消 | `AbortSignal` 透传 | CLI 进程被杀时停止轮询 |

失败分类（都要给可读中文错误，不谎报成功）：

- `task_status: FAILED` → 带上游 message
- HTTP 401 → token 无效/未配置，提示到设置页配置
- HTTP 429 / 额度错误 → 提示当日免费额度可能用尽
- `timeoutMs` 超时 → 说明仍在跑、可用 task_id 追踪（若上游提供查询接口）
- 产物 URL 下载失败 → 单独报错，不吞掉

### 3.4 GenerationModule（backend）

新增 `packages/backend/src/app-runtime/modules/generation/index.ts`，
**不复用 `ImageModule`**（后者只管识别；生图与生视频同族，独立成模块更好扩展）。

职责链：

```
resolveModel(设置页配置 > 报错)          ← 无 CLI 模型参数（决策 7）
  → 校验 outputModalities 含 image
  → 取 integration.mediaGeneration.image（缺失则报「该服务商不支持生图」）
  → generator.generate({ outputDir, timeoutMs, signal, ... })
  → 产物写入 outputDir（CLI --output 显式传入）
  → 返回 { files, providerId, modelId, taskId, elapsedMs }
```

落盘约定：

- 目录来自请求参数 `outputDir`（CLI `--output`，缺省 `./generated` 相对 CLI 进程
  cwd——agent 场景即 workspace，人工场景即当前目录）；后端必填校验，**不做任何
  workspace 默认推导**（决策 8：CLI → appControl 链路本就没有会话/workspace 上下文，
  显式传递避免产物落错位置）
- 文件名 `<timestamp>-<prompt slug>.<ext>`
- 已存在同名文件时加序号，不覆盖
- **产物落盘即交付终点**（对后端而言）：是否进入聊天由 agent 显式转发决定（3.5），
  后端不做任何认领/附加

### 3.5 产物交付：agent 显式转发（`send_attachment`）

**机制**：CLI 落盘产物并在 `--json` 返回 `files[].path` → SKILL 教 agent 调
`send_attachment(path)` 转发 → 复用其全部既有链路：

- 桌面/自动化 turn：outputBlocks 附加到当轮回复（`persistedTurn` →
  `updateAssistantMessage` → sqlite stage/commit → `message:updated` →
  前端 `MessageAttachments`/`ImageViewer` 渲染）
- 频道 turn：`send_attachment` 已按 `turnSource` 自动分流，直接把图发到
  微信/飞书会话（[sendAttachmentTool.ts](../../packages/backend/src/agent-core/native-tools/tools/sendAttachmentTool.ts#L44-L68)）
- 体积校验（图片 10MB 上限）、路径权限（pathPolicy）均由 `send_attachment` 现有逻辑承担

**零新增机制**：没有 registry、没有认领、没有时间窗口、没有 turnSource 分流的
新增代码——后端落盘即结束，交付完全走 `send_attachment` 既有路径。

**代价与缓解（决策 3 修订的核心取舍）**：

- **LLM 忘记转发 = 图不出现**（静默失败）。缓解：
  - SKILL 明确教学「生成完成后**必须**用 `send_attachment` 把图发给用户」（3.8）；
  - 产物文件保留在工作区，用户追问时 LLM 可随时补发（非永久丢失）；
  - 真机验证（六.7）把「生成→转发」列为验收路径，观察实际遵从率，必要时再评估
    恢复系统保证附加（native tool 方案已记录在决策 3 的路线演变里）。
- **多步任务中不转发是正确行为**（生图是中间产物时不该刷屏）——显式转发的
  语义在这类场景反而优于自动附加。

**与 file_id 变体的区分**（评审记录）：CLI 只返回 `path`，不引入附件 `file_id`。
产物已落盘 workspace，path 零成本；file_id 需要产物预写入附件存储的新接口 +
`send_attachment` 改造，与「零新机制」矛盾。`image recognize` 的 `fileId` 是
输入方向（读不在文件系统的聊天附件），生图产物无此需求。

### 3.6 设置与 UI

- `AppSettingsSchema` 增 `imageGenProviderId` / `imageGenModelId`（默认 `''`，旧配置自动补默认，无需迁移）。
  与现有 `visionProviderId/visionModelId` 同构；视频后续加 `videoGen*`。
- 设置页新增「图像生成模型」选择器，过滤 `outputModalities` 含 `image`
  （复用 `ModelSelect`，与 [SelectVisionModel.tsx](../../apps/web/src/components/GeneralSettings/SelectVisionModel.tsx) 同构）。
- 「添加模型」表单增加**输出类型标注**（图片/视频，写 `outputModalities`）——
  手填 model id（决策 1）闭环的必要改动，否则手填模型进不了生图选择器
  （现状只支持输入模态，见 [AddModelForm.tsx](../../apps/web/src/components/ProviderManage/ModelList/AddModelForm.tsx)）。
- `ant-chat settings show` 增一行 `Image generation: <provider> / <model>`。

### 3.7 CLI 命令

```bash
ant-chat image generate --prompt "一只金色小猫在阳光下" \
  [--width 1024 --height 1024] [--output <dir>] [--timeout <ms>] [--json]
```

- **无模型参数**（决策 7）：模型一律来自设置页配置（`imageGenProviderId/imageGenModelId`），
  未配置时报可读错误提示到设置页。
- `--output <dir>`：产物目录，显式传入后端（必填语义）；缺省 `./generated`
  （相对 CLI 进程 cwd）。
- `--timeout <ms>`：同时约束 CLI 响应等待与后端总超时（透传）；未传则两者都不设
  默认，由外层调用者兜底（见「四」）。

改动点（与 `recognize` 并列，四处对齐）：

1. `packages/shared/src/interfaces/app-control.ts` — `ImageGenerateCommandSchema` + union + `AppControlResultMap`
2. `packages/backend/src/app-control/appControl.ts` — `executeImage` 增 `generate` 分支
3. `packages/control-client/src/commands/index.ts` — `parseImage` 增 `generate` + 人类可读输出
4. `packages/backend/src/app-runtime/register-modules.ts` — 装配 `GenerationModule`

`--json` 输出契约：`result.files[].path`、`result.providerId/modelId`、`result.taskId`、`result.elapsedMs`。
（`files[].path` 是 agent 转发动作的输入：SKILL 教 agent 拿它调
`send_attachment(path)`，见 3.5/3.8。）

### 3.8 bundled SKILL `image-generation`

新增 `packages/backend/builtin-skills/image-generation/SKILL.md`：

- 何时用：用户要图（插画、封面、示意图、配图）
- 执行路径：`ant-chat image generate --prompt "..." --output ./generated --json`
- **必须传 `execute_command` 的 `timeoutMs`**（如 300000；生图是阻塞等待，远超
  `execute_command` 默认 10s）——这是 agent 侧唯一的超时闸门，超时杀进程即触发
  abort 停止后端轮询（见「四」）；CLI `--timeout` 是人工/脚本场景参数，agent 不需要
- **生成完成后必须用 `send_attachment(path)` 把图发给用户**（决策 3 显式转发）：
  读取 `--json` 输出的 `result.files[].path`，逐张转发；漏掉这步用户就看不到图。
  生图是中间产物（后续还要加工/引用）时可以不转发，说明去向即可
- 说明用了哪个模型；失败如实上报：额度用尽、内容审核、超时
- **不擅自连续重试**（免费额度有限，重复失败要先问用户）

### 3.9 视频（后续）

同一抽象的第二条通道，无需改通用流程：

- `ant-chat video generate ...`，走 `mediaGeneration.video` 通道（请求形态与 3.1 一致，
  不带 `kind`）
- 设置项 `videoGenProviderId/videoGenModelId`
- ModelScope：`POST /v1/videos/generations`（路由已确认存在），
  task type 与参数**待真机验证**

## 四、超时与取消（已决策）

### 4.1 超时由调用方决定，无系统默认值

现状：CLI 侧响应超时是硬编码常量（[socket-client.ts](../../packages/control-client/src/socket-client.ts#L17-L20)）：

```ts
const RESPONSE_TIMEOUT_MS = 120_000
```

写完请求开始计时，超时即 destroy socket 报「等待响应超时」——而后端任务不受影响、
仍在轮询。生图阻塞轮询（决策 2）一旦超过 120s 就会踩中。

**决策（问题 1-B，2026-09-26 评审修订）：调用方决定，不设命令级默认。**

- **socket 层**：`SocketClient.send()` 接收可选 `timeoutMs`；`undefined` = 不设响应
  超时（阻塞等待），常量移除
- **CLI `--timeout <ms>`**：显式设置，同时作为 CLI 响应超时**透传给后端**作为
  generator 总超时（`MediaGenerationRequest.timeoutMs`）——只抬 CLI 层不透传没有
  意义（后端会先报超时），两层必须一起生效
- **未传 `--timeout`**：CLI 无限等待响应，由外层调用者兜底——
  - agent 场景：`execute_command` 的 `timeoutMs`（SKILL 显式传）超时即杀 CLI
    进程组 → 触发 4.2 abort → 后端停止轮询；
  - 人工/脚本场景：Ctrl-C / 调用方自己的超时控制，同样经 abort 传播停止后端
- **后端 generator**：收到 `timeoutMs` 则按它超时；未收到则不主动超时，
  完全依赖 AbortSignal 取消

行为变化注意：`image recognize` 迁移到同一规则后，其现有 120s 兜底消失——
未传 `--timeout` 且调用方未设 `execute_command timeoutMs` 时，识别超过 10s
（`execute_command` 默认值）会被外层杀掉。现有 image-recognition SKILL 已教
`timeoutMs`，实际影响面小，但需在迁移说明中标注。

### 4.2 断连传播为 AbortSignal

现状：CLI 进程消失时（超时自杀 / Ctrl-C / agent 杀进程组），`localControlServer` 的
`socket.on('close')` 只做 `clearTimeout`，不通知执行中的命令——生图照样跑、额度照扣、
结果没人接，agent 还可能重试再扣一次。

**决策（问题 2-A）：补 abort 传播。**

链路：socket close → `AbortSignal` → `AppControl.execute` → 命令处理器（GenerationModule）
→ `MediaGenerator` → 停止轮询。

改动点：

- [localControlServer.ts](../../packages/backend/src/app-control/localControlServer.ts)：每个连接持有
  `AbortController`，close 时 abort。**注意 close 语义**：CLI 正常收到响应后 `end()`
  也会触发服务端 `close`——必须只在「请求执行中、响应尚未写回」时 abort，
  需要按请求生命周期跟踪状态，避免正常完成被误判为断连。
- [appControl.ts](../../packages/backend/src/app-control/appControl.ts)：`execute(command, { signal })`
- `GenerationModule` / `MediaGenerator`：signal 透传（`MediaGenerationRequest.signal` 已在 3.1 定义）

服务端请求读取阶段不受影响：`MESSAGE_TIMEOUT_MS` 只覆盖请求读取，收到完整请求行后即
`clearTimeout`，执行阶段无超时。

## 五、待验证与风险

1. **视频接口参数与 task type**（推测 `video_generation`）——需真实 token 验证
2. **每日额度官方规则**——目前只有二手来源
3. **内置生图清单的实际可用性**——哪些 model id 在 API-Inference 上真能跑、免费
4. **`output_images` URL 的下载鉴权与有效期**——需确认是否需要额外 header、是否签名过期
5. **内容审核失败的返回形态**——决定错误文案质量
6. **产物体积**：1024×1024 PNG 通常 1~2MB，低于 `send_attachment` 的 10MB 图片上限；
   4K 或视频会触顶，需要在命令层提前提示（显式转发路线下体积校验完全依赖
   `send_attachment`，触顶即转发失败——提前提示更重要）
7. **无默认超时下的无限轮询**：未传 `timeoutMs` 且调用方不退出（如人工 CLI 挂着
   不管）时，上游任务若永久 `PENDING` 会无限轮询——决策 5 接受此风险（abort 是
   主取消机制）；若真机验证发现上游存在永久 PENDING 形态，再评估是否加保底上限
8. **`image recognize` 迁移到无默认超时后的行为变化**——未传 `--timeout` 且
   调用方未设 `timeoutMs` 的裸调用，从「CLI 120s 兜底」变为「execute_command
   默认 10s 杀掉」（见 4.1），需在迁移时回归识别场景
9. **LLM 忘记转发**（决策 3 显式转发的核心代价）：单步画图任务中 agent 漏调
   `send_attachment` 时图不出现（静默失败）。缓解见 3.5——SKILL 强制教学、
   产物保留工作区可补发；**真机验证需统计「生成→转发」遵从率**，不达标时
   按决策 3 路线记录回退到 native tool 方案

## 六、实施顺序

1. Provider 抽象扩展（`mediaGeneration` 类型 + registry 校验）+ 单测
2. ModelScope Integration（固定 endpoint 校验、模型源合并、异步 generator）+ 单测
   （fake fetch / fake timer 覆盖：成功、FAILED、超时、401、429、取消）
3. **超时调用方化 + abort 传播**（socket 层 + CLI `--timeout` 双透传 +
   localControlServer + appControl）——独立于生图，可先落地并单独验证
4. `GenerationModule` + AppControl 命令 + CLI（落盘返回 path，无认领机制）
5. 设置字段 + UI 选择器 + 「添加模型」输出类型标注（手填闭环）
6. `image-generation` SKILL（含「生成后必须 `send_attachment` 转发」教学）
7. **真机验证**：用真实 token 跑通一张 `Qwen/Qwen-Image`，确认轮询、下载、落盘、
   **agent 显式转发（生成后图出现在回复里，统计遵从率）**、断连取消
8. 文档收尾：更新 `image-recognition.md` 的「不做生图」边界，补本文档状态

## 七、实现落点（2026-09-28）

| 步骤 | 落点 |
|---|---|
| 1 | `providerIntegration.ts`：`MediaKind`/`MediaGenerationRequest`/`MediaGenerationResult`/`MediaGenerator`；`ProviderModule.getMediaGenerator` + 注册期一致性校验 |
| 2 | `modelscopeIntegration.ts`：固定 endpoint 校验、models.dev chat + 内置生图清单合并（目录查询 key 固定为 models.dev 的 `modelscope`，手动创建的随机 id Provider 同样可用）、`ModelScopeAsyncImageGenerator`（submit + 3s 轮询 + 下载落盘）；单测覆盖成功/FAILED/401/429/超时/取消/下载失败/同名序号/跨 host 不带凭据；`DEFAULT_APP_SETTINGS` 新增内置 `modelscope` 服务商（预置、可删除，Keychain secret ref 与 openai 同构，老配置自动合并） |
| 3 | `socket-client.ts` 响应超时调用方化（`send(command, { timeoutMs })`）；`localControlServer.ts` 断连 → AbortSignal（仅在请求执行中且未写回响应时触发）；`AppControl.execute(command, { signal })` |
| 4 | `modules/generation/index.ts`；`app-control.ts` `image:generate`；CLI `image generate`（缺省 `--output ./generated`、`--timeout` 双生效） |
| 5 | `imageGenProviderId/imageGenModelId` + `SelectImageGenModel` + AddModelForm「支持输出类型」标注 |
| 6 | `builtin-skills/image-generation/SKILL.md`（含「生成后必须 `send_attachment` 转发」） |
| 8 | 本文档与 `image-recognition.md` 边界更新 |
| 7 | **未完成**：真机验证（需要真实 token；验证清单见下） |

真机验证清单（待执行）：

- 设置页配置 ModelScope API Key + 同步模型，选择 `Qwen/Qwen-Image` 为图像生成模型
- `ant-chat image generate --prompt "..." --output ./generated --json` 确认落盘与 `files[].path`
- agent 场景：确认生成后 `send_attachment` 转发的出现率（不达标时按决策 3 路线回退 native tool 方案）
- 断连取消：生图中途 Ctrl-C / 杀进程，确认后端停止轮询（上游不再扣额度）
- 观察内容审核失败形态、产物 URL 下载鉴权、每日额度实际规则（补「五、待验证与风险」）

### 修复记录（2026-09-28，真机验证发现）

1. **桌面端附件不展示**：`send_attachment` 桌面分支把 outputBlocks 正确写入了助手消息
   （DB 已验证含 image 块、附件已落盘），但前端只有用户消息渲染附件——助手消息走
   `TurnTrace`/`buildTurnSteps`，附件块被直接丢弃。修复：`turnSteps` 新增 `attachment`
   step，`TurnTrace` 用既有 `MessageAttachments` 原位渲染（图片走 ImageViewer、
   文档/文件走文件卡片）。展示顺序上，附件统一延后到本消息工具调用之后（持久化
   content 中附件先于 `tool-call` 出现，渲染层重排为「工具卡片在前、产物在后」，
   对已落盘的历史消息同样生效）。
2. **dev 环境产物默认路径跑偏**：`scripts/link-cli-dev.mjs` 的 dev wrapper 为了让
   `node --import tsx` 解析到 loader，把 CLI 进程 cwd 固定为 `packages/ant-chat`，
   导致 `--output ./generated` 落到 `packages/ant-chat/generated` 而非工作区。修复：
   wrapper 改用包解析出的 tsx loader 绝对路径（`TSX_TSCONFIG_PATH` 显式传包内
   tsconfig），cwd 保持调用者目录；`GenerationModule` 同步收紧为只接受绝对路径
   （相对路径直接报错，不再静默按后端 cwd 解析）。

## 关键引用

- Integration 注册：`packages/backend/src/app-runtime/register-modules.ts`
- Integration 接口：`packages/backend/src/app-runtime/modules/provider/providerIntegration.ts`
- Integration 参考实现（固定 endpoint + 自有 client）：`packages/backend/src/app-runtime/modules/provider/codexIntegration.ts`
- 识别实现（同族命令的样板）：`packages/backend/src/app-runtime/modules/image/index.ts`
- 命令契约：`packages/shared/src/interfaces/app-control.ts`
- CLI 解析：`packages/control-client/src/commands/index.ts`
- CLI socket 客户端（超时调用方化改动点）：`packages/control-client/src/socket-client.ts`
- 控制面 socket 服务（abort 传播改动点）：`packages/backend/src/app-control/localControlServer.ts`
- **产物交付主路径**（agent 显式转发复用，零改动）：
  `packages/backend/src/agent-core/native-tools/tools/sendAttachmentTool.ts`
- 消息落盘（附件 stage/commit，交付终点）：`packages/backend/src/data/sqlite/repositories/sqliteMessageRepository.ts`
- 附件块 transport / 持久化形态：`packages/shared/src/schemas/messages.ts`
- 手动添加模型表单（需补输出类型标注）：`apps/web/src/components/ProviderManage/ModelList/AddModelForm.tsx`
- 现有能力文档：`docs/image-recognition.md`
