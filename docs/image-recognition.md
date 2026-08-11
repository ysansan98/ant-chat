# 图像识别能力（分支 `image-recognition`）

> 状态：实现完成，改动在工作区未提交；验证通过（type-check / eslint / 定向测试）。

## 背景与决策

用户使用纯文本模型（如 `opencode-go/deepseek-v4-flash`，models.dev 标注 `modalities.input=["text"]`）时，
聊天里发送图片会导致 ant-chat 把图片以 `image_url` 形式发给上游，纯文本模型拒绝（`unknown variant 'image_url', expected 'text'`）。

方案决策（用户拍板）：

- 只做**图像识别**（图片内容理解）；OCR、生图、编辑、增强一律不做。
- 实现形式 = **`ant-chat` CLI 子命令 + bundled SKILL**，由 agent 通过 `execute_command` 主动调用；
  **不做** runtime 自动识别兜底、**不做**内置 native tool。
- 识别模型**必须由用户在设置页预先配置**（视觉模型），agent 不自己选模型。
- 前端附件**暂时只允许图片**。
- 模型不支持图片输入时，把图片附件**替换为汇总占位符文本**（含 `file_id`），由 agent 自行调用识别命令。

## 能力清单

### 1. 图像识别命令 `ant-chat image recognize`

CLI 能力（非内置 Tool），入口：`packages/control-client/src/commands/index.ts`，执行链路：
`ant-chat CLI → AppControl → ImageModule`。

两种输入（互斥，schema 校验在 socket 边界 `localControlServer.ts`）：

```bash
# 工作区图片：按绝对路径读取
ant-chat image recognize /abs/path/to/image.png --json

# 聊天附件：按 file_id 读取（应用内附件存储，绕开工作区外路径权限）
ant-chat image recognize --file-id img-1 --json
```

行为：

- 模型解析优先级：显式 `--provider-id/--model-id` > 设置页视觉模型（`visionProviderId/visionModelId`）> 默认模型兜底。
- 模型不支持图片输入时报可读中文错误，提示配置视觉模型或显式指定。
- 图片校验：png/jpg/jpeg/webp/gif（扩展名 + 文件头 magic bytes 双重判定）、≤10MB。
- `--json` 输出契约：`result.text`（识别文本）、`result.providerId/result.modelId`（实际使用的模型）、`result.usage`。

关键文件：

- `packages/shared/src/interfaces/app-control.ts` — `ImageRecognizeCommandSchema`（`path`/`fileId` 二选一）
- `packages/backend/src/app-runtime/modules/image/index.ts` — `ImageModule.recognize` / `readImage` / `readAttachment`
- `packages/backend/src/app-control/appControl.ts`、`controlPlane.ts` — 控制面分发
- `packages/control-client/src/commands/index.ts` — CLI 解析与人类可读输出

### 2. bundled SKILL `image-recognition`

`packages/backend/builtin-skills/image-recognition/SKILL.md`：agent 通过 `execute_command` 主动调用。
覆盖：何时使用、执行路径、`--file-id`/`--prompt` 用法、`--json` 结果解析、失败处理、明确排除 OCR。

### 3. 视觉模型用户预配置

- 设置页"视觉模型 → 图像识别模型"区块：`apps/web/src/pages/Settings/GeneralSettings.tsx` +
  `apps/web/src/components/GeneralSettings/SelectVisionModel.tsx`（只列 `inputModalities` 含 image 的模型）。
- 持久化：`visionProviderId/visionModelId`（schema 默认 `''`，旧配置自动补默认，无需迁移）。
- agent 调用识别命令时缺省使用该配置；未配置时报错并提示到设置页配置。

### 4. 模型不支持图片时的占位符闭环

目标模型 `inputModalities` 不含 image 时（`SessionRuntime.prepareTask`），把图片附件替换成**汇总列表占位符**
（`packages/backend/src/agent-core/utils/attachmentUtils.ts`）：

```text
[用户上传了 2 张图片：1) a.png file_id=img-1 2) b.jpg file_id=img-2。
当前模型不支持直接查看图片，请用图像识别命令逐张识别（如 ant-chat image recognize --file-id img-1 --json），
再结合识别结果回答用户。]
```

要点：

- **多图支持**：N 张图合并为单块列表，agent 逐张识别，不产生 N 段重复指令。
- **词汇统一**：占位符、CLI 参数、内部字段统一使用 `file_id`，模型无需映射。
- **路径权限解耦**：附件读取走应用内附件存储（`loadAttachmentData`），不经过文件系统路径，规避工作区外路径权限问题。
- **覆盖范围**：用户消息 + 历史上下文（含 compaction 前），任何环节都不会把 image part 发给纯文本模型。
- **可观测性**：替换列表 `projectedUnsupportedImages` → trace 事件 `image_capability_placeholder`
  （`packages/backend/src/agent-core/loop/agentLoop.ts`），无额外 UI。
- 模型支持图片输入时原样直发（AI SDK 序列化为对应协议格式）。

### 5. 前端附件约束

`apps/web/src/components/Sender/senderModel.ts`：附件固定仅图片（`fileAccept = 'image/*'`），tooltip 同步
（`SenderAttachments.tsx`）。暂不支持其他文件类型；动态模态映射（`MODALITY_ACCEPT_MAP`/`buildAcceptFromModalities`）
保留注释待后续能力恢复。

## 边界（明确不做）

- OCR、图像生成/编辑/增强：不做。
- runtime 自动识别兜底：不做（识别由 agent 按 SKILL 主动触发，避免消息级隐式换模型的花费与不可见失败）。
- 内置 native tool：不做（不好扩展）。

## 验证状态

- `pnpm type-check` ✓
- 改动文件 `eslint --fix` ✓
- backend 定向：689 passed（`agentFullChainPermissions.spec.ts` 5 个失败为 known better-sqlite3 ABI blocker，
  NODE_MODULE_VERSION 143 vs 137，与本次无关）
- shared 56 passed、control-client 12 passed
- 测试覆盖：占位符单图/多图汇总、`onReplaced` 收集、`fileId` 读取与附件缺失、`fileId` 优先、
  socket 边界 `path`/`fileId` 互斥校验、CLI `--file-id` 解析、模型能力判定（支持/不支持）

## 关键引用

- 占位符组装：`packages/backend/src/agent-core/utils/attachmentUtils.ts`
- 模型能力判定 + 替换触发：`packages/backend/src/agent-core/session/SessionRuntime.ts`
- 识别实现：`packages/backend/src/app-runtime/modules/image/index.ts`
- 命令契约：`packages/shared/src/interfaces/app-control.ts`
- SKILL：`packages/backend/builtin-skills/image-recognition/SKILL.md`
- 附件限制：`apps/web/src/components/Sender/senderModel.ts`
