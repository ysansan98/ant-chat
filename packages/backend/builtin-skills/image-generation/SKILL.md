---
name: image-generation
description: 当用户要求生成图片（插画、封面、示意图、配图、海报、头像等）时使用。通过 ant-chat CLI 调用设置页配置的图像生成模型生成图片，产物落盘后用 send_attachment 发给用户。
---

# Image Generation

用于「生成图片」：把文字提示词交给配置好的生图模型（当前支持 ModelScope 的
`Qwen/Qwen-Image` 等），阻塞等待生成完成，产物落到本地文件。

## 何时使用

- 用户要求画图、生成配图、插画、封面、示意图、头像等视觉素材。
- 用户需要一张图作为后续任务的输入（例如先画图再插入文档）。

不要用本技能做图像编辑（输入图 + 指令改写，暂不支持）与视频生成（后续能力）。

## 前置配置

- 生图模型来自设置页的「图像生成模型」（`imageGenProviderId/imageGenModelId`）。未配置时命令会报错并提示。
- ModelScope（魔搭）是内置服务商：在 Provider 管理里为它配置 API Key 并「同步模型」，即可获得内置生图清单（含 `Qwen/Qwen-Image`）。
- 模型必须标注图片输出能力：ModelScope 的「同步模型」会带入内置生图清单；手填 model id 时需在模型管理里「添加模型」并勾选输出类型「图片」。

## 执行路径

1. 调用 CLI（工作区内执行，产物目录默认相对当前目录）：

```bash
ant-chat image generate --prompt "一只金色小猫在阳光下" --output ./generated --json
```

2. **必须设置 `execute_command` 的 `timeoutMs`**：生图是阻塞等待（提交 → 轮询 → 下载产物，通常 10~60 秒，高峰期更久），远超默认的 10 秒超时。显式传 `timeoutMs: 300000`（5 分钟）。超时杀进程会同时停止后端轮询，不会白扣额度：

```json
{ "command": "ant-chat image generate --prompt \"一只金色小猫在阳光下\" --output ./generated --json", "timeoutMs": 300000 }
```

3. 可选参数：
   - `--width/--height <像素>`：目标尺寸，如 `--width 1024 --height 1024`（同时提供才生效）。
   - `--output <目录>`：产物目录，缺省 `./generated`（相对 CLI 进程 cwd，即工作区）。
   - `--timeout <毫秒>`：人工/脚本场景的响应等待超时；agent 场景用 `timeoutMs` 即可，不需要该参数。

4. 从 `--json` 输出读取结果：`result.files[].path` 是本地图片绝对路径；`result.providerId/result.modelId` 是实际使用的模型；`result.elapsedMs` 是耗时；`result.taskId` 是上游任务 ID（排查用）。

5. **生成完成后必须把图发给用户**：对 `result.files[]` 逐张调用 `send_attachment(path)`（桌面端会附加到当前回复；微信/飞书频道会话会直接发到聊天）。漏掉这一步用户就看不到图。

6. 回复中说明使用的模型与产物位置。如果生图是中间产物（后续还要加工/引用）且用户没要求现在看，可以不转发，但要说清文件去向。

## 失败处理

- 失败如实上报，不谎报成功：额度用尽（HTTP 429）、内容审核未通过（任务 FAILED，带上游原因）、超时（可用 taskId 追踪）、API Key 未配置（HTTP 401）等，并给可执行的下一步。
- **不擅自连续重试**：免费额度有限，同一提示词重复失败要先问用户是否重试或修改提示词。

## 限制

- 产物为图片文件（通常 1~2MB）；`send_attachment` 图片上限 10MB，4K 等大图可能触顶——触顶时告知用户文件已在工作区，可改用文件方式获取。
- 图像编辑（输入图 + 指令改写）本期不支持，不要假装可以。
