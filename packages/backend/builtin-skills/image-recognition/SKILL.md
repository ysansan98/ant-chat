---
name: image-recognition
description: 当用户提供了图片（聊天附件、工作区图片、截图）并要求识别、描述、解释图片内容，而当前模型不支持直接看图时使用。通过 ant-chat CLI 调用配置的视觉模型识别图片并返回文本描述。
---

# Image Recognition

用于「看懂图片」：把一张本地图片交给支持视觉输入的模型，返回对图片内容的文字描述。

## 何时使用

- 用户上传了图片并要求描述、解释、总结图片内容（场景、物体、图表、截图、文档截图）。
- 用户消息里出现「用户上传了 N 张图片 + `file_id=<id>`」格式的占位符：这是当前模型不支持图片输入时，运行时把图片附件替换成的占位文本。用 `--file-id` 逐个识别占位符里列出的附件后再回答。
- 当前会话模型不支持图片输入（`read_file` 只能读到图片路径/元数据，拿不到像素）。
- 需要把图片内容作为上下文继续处理时。

不要用本技能做精确文字提取（OCR 不在范围内）；如果用户要求逐字提取文字，明确说明当前不支持。

## 执行路径

1. 先确认图片文件存在，并把路径转为绝对路径。
2. 调用 CLI（正常路径是 `execute_command` 运行 `ant-chat`）：

```bash
ant-chat image recognize /abs/path/to/image.png --json
```

3. 聊天附件场景用 `--file-id` 识别（附件 id 来自占位符里的 `file_id=`，读取走应用内附件存储，不依赖文件路径）：

```bash
ant-chat image recognize --file-id img-1 --json
```

4. 用 `--prompt` 定制识别指令（默认是通用描述）：

```bash
ant-chat image recognize /abs/path/screenshot.png --prompt "这张截图里发生了什么，列出关键信息" --json
```

5. 输出按 `--json` 解析：`result.text` 是识别文本，`result.providerId/result.modelId` 是实际使用的模型。
6. 把识别结果整理后回复用户；说明用哪个模型识别的。占位符里有多张图时逐张识别。

## 模型选择

- 不带 `--provider-id/--model-id` 时，使用当前默认模型；如果默认模型不支持图片输入，命令会报错并提示。
- 需要显式指定支持视觉的模型时：

```bash
ant-chat image recognize ./photo.png --provider-id provider-1 --model-id gpt-4o-mini --json
```

- 只做临时覆盖，不要修改任何持久化配置。

## 限制

- 支持 png / jpg / jpeg / webp / gif，单张不超过 10MB。
- 图片路径必须是本地绝对路径；远端 URL 先下载到工作区再识别。
- 识别是一次性模型调用：失败时解释错误（模型不支持、文件不存在、体积超限、provider 未配置密钥），并给出下一步动作，不要谎报成功。
