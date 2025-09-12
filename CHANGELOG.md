# [1.0.0-alpha.0](https://github.com/whitexie/ant-chat/compare/v0.6.0...v1.0.0-alpha.0) (2025-09-12)


### Bug Fixes

* 补充[#12](https://github.com/whitexie/ant-chat/issues/12)的迁移文件 ([2cf6510](https://github.com/whitexie/ant-chat/commit/2cf6510e58f1e8e1187b706d4e0b8478c5566b31))
* 修复 MCP 配置 headers 字段的默认值类型 ([06c04e9](https://github.com/whitexie/ant-chat/commit/06c04e9556235ea78708239c58b7714ed12a98d8))


### Features

* 实现自动更新功能 ([070ec51](https://github.com/whitexie/ant-chat/commit/070ec51f506d6b8ed4ed654cd70addbe6e0b003c))



# [0.6.0](https://github.com/whitexie/ant-chat/compare/v0.6.0-alpha.1...v0.6.0) (2025-09-03)


### Features

* 添加代理管理功能 ([#11](https://github.com/whitexie/ant-chat/issues/11)) ([63a9094](https://github.com/whitexie/ant-chat/commit/63a9094f53e32b27fcc2b1514ff8e421a0bf35cd))
* sse mcp 支持 配置请求头(headers) ([#12](https://github.com/whitexie/ant-chat/issues/12)) ([12aeed8](https://github.com/whitexie/ant-chat/commit/12aeed859ca1c8622eee6f815d612b318d5ec15c))



# [0.6.0-alpha.1](https://github.com/whitexie/ant-chat/compare/v0.6.0-alpha.0...v0.6.0-alpha.1) (2025-08-14)



# [0.6.0-alpha.0](https://github.com/whitexie/ant-chat/compare/v0.5.0...v0.6.0-alpha.0) (2025-08-14)


### Features

* 重构为electron 应用 ([#9](https://github.com/whitexie/ant-chat/issues/9)) ([7a53328](https://github.com/whitexie/ant-chat/commit/7a53328f34f45ecece53d2cead66c48772bee3e2))


# [0.5.0](https://github.com/whitexie/ant-chat/compare/v0.4.7...v0.5.0) (2025-03-30)


### Features

* 支持 渲染Mermaid 图表 ([afb8f9d](https://github.com/whitexie/ant-chat/commit/afb8f9d84032b8530048517893e180e86845a215))
* 支持预览 HTML代码块 ([fd01dac](https://github.com/whitexie/ant-chat/commit/fd01dacc4c1a02b6c3d058083269b8733075807e))
* **Mermaid:** 新增 Mermaid 图表支持 ([49a4aae](https://github.com/whitexie/ant-chat/commit/49a4aae2a90fb03ed00c9748b5a29cd835b5f660))



## [0.4.7](https://github.com/whitexie/ant-chat/compare/v0.4.6...v0.4.7) (2025-03-26)


### Bug Fixes

* **BubbleList:** 优化AI回复的打字效果 ([db4ed78](https://github.com/whitexie/ant-chat/commit/db4ed7897d56014f8122fc91972fa610b20435de))
* **Chat:**  优化错误消息显示 ([7f34e7d](https://github.com/whitexie/ant-chat/commit/7f34e7da786c881fabcaf8d6f0e26c54d16f2b66))
* **Chat:** 更新消息发送逻辑，优化会话标题初始化 ([db8b7f8](https://github.com/whitexie/ant-chat/commit/db8b7f83958676f13b718623bed5a0951ee38f6f))
* **Chat:** 优化聊天气泡列表的滚动行为和消息渲染 ([409f968](https://github.com/whitexie/ant-chat/commit/409f96814eb14be5d265d5b5cbc83b475344c9c3))
* **Chat:** 重构聊天气泡列表，增加无限滚动和消息加载功能 ([824ebb2](https://github.com/whitexie/ant-chat/commit/824ebb2bc77ae693b590135dee2c3806e54eaa76))
* **InfiniteScroll:** 优化滚动到底部的逻辑 ([a327d25](https://github.com/whitexie/ant-chat/commit/a327d25fe18c4ed5ae73272a21ecbfe01d324a87))


### Features

* **Chat:** 增强聊天气泡列表的自动滚动功能 ([78b92cb](https://github.com/whitexie/ant-chat/commit/78b92cbf4f3f2dc9fc5d2e2159a4f97bf038fc36))
* **ConversationsManage:** 增加会话分组功能 ([7a2bb94](https://github.com/whitexie/ant-chat/commit/7a2bb94002d21deaa1a4fd25e11261c5838e5061))
* **db:** 增加会话更新时间字段和相关功能 ([84285e7](https://github.com/whitexie/ant-chat/commit/84285e70d93ff0f119f8336e1540526579ca5bba))
* **Sender:** 新增语音输入功能 ([8bd10d4](https://github.com/whitexie/ant-chat/commit/8bd10d43cc10e975ad9d15eedba6fd0f65e0cf5c))



## [0.4.6](https://github.com/whitexie/ant-chat/compare/v0.4.5...v0.4.6) (2025-03-13)


### Bug Fixes

* 确保在主题更改时正确切换主题类 ([e18d55d](https://github.com/whitexie/ant-chat/commit/e18d55d3afcec4def79aba1ea61279faae1e86a2))
* 输入法激活时不触发消息发送 ([750d28d](https://github.com/whitexie/ant-chat/commit/750d28d2491c897436b8c7d283dabaee85b3df7b))
* 主题跟随系统变化 ([5d28d9d](https://github.com/whitexie/ant-chat/commit/5d28d9d48e5e523d6b7fd1a367137cbdf29101da))



## [0.4.5](https://github.com/whitexie/ant-chat/compare/v0.4.4...v0.4.5) (2025-03-04)


### Bug Fixes

* 完善模型配置检查和设置弹窗管理 ([3552460](https://github.com/whitexie/ant-chat/commit/355246053c58260921d729a8369bad92e9888a65))


### Features

* 优化聊天气泡列表和消息状态展示 ([0c60a90](https://github.com/whitexie/ant-chat/commit/0c60a90b1461cc3a430b4d57cce2df389c8c5ae0))



## [0.4.4](https://github.com/whitexie/ant-chat/compare/v0.4.3...v0.4.4) (2025-03-04)


### Bug Fixes

* 修复消息无法打断问题 ([ec2924c](https://github.com/whitexie/ant-chat/commit/ec2924c5be88cd6017658cbac92e1ea46059224e))
* **Sender:** 修复文本域为空时，通过回按键触发onSubmit事件 ([8756d27](https://github.com/whitexie/ant-chat/commit/8756d276addf04b37f182b52d041669820097f5c))
* **types:** 修复组件引用类型 ([6672f1f](https://github.com/whitexie/ant-chat/commit/6672f1f785c3090ad5458b37040779ab2a4570f7))


### Features

* 添加打字效果组件并在聊天界面应用 ([7af317e](https://github.com/whitexie/ant-chat/commit/7af317e943dff8d5fcce09afcf6f667eeffe599e))



## [0.4.3](https://github.com/whitexie/ant-chat/compare/v0.4.2...v0.4.3) (2025-02-26)


### Bug Fixes

* 修复对话导出缺少messages数据 ([32c7b20](https://github.com/whitexie/ant-chat/commit/32c7b200c4d7640386bb2c7241859868a16f8e6b))



## [0.4.2](https://github.com/whitexie/ant-chat/compare/v0.4.1...v0.4.2) (2025-02-22)


### Bug Fixes

* `联网搜索`tooltip不生效 ([9346f12](https://github.com/whitexie/ant-chat/commit/9346f12be30f872cd38c4af976cf62ef91dfae22))


### Features

* 支持`深度思考`过程显示 ([dc3d3e1](https://github.com/whitexie/ant-chat/commit/dc3d3e1a1c48a8f52b84a7bcd4f377162c6dc9b5))



## [0.4.1](https://github.com/whitexie/ant-chat/compare/v0.4.0...v0.4.1) (2025-02-21)


### Bug Fixes

* 移动端提示被输入框遮挡 ([e9b5c45](https://github.com/whitexie/ant-chat/commit/e9b5c45ff72bc5ea9818f80895e4b92cc3ccd8ee))



# [0.4.0](https://github.com/whitexie/ant-chat/compare/v0.3.0...v0.4.0) (2025-02-21)


### Bug Fixes

* 移除百度统计代码 ([caeed10](https://github.com/whitexie/ant-chat/commit/caeed109570212be5d84e5464ab85277ef94fcd0))
* 优化黑暗模式mask背景适配 ([350a86c](https://github.com/whitexie/ant-chat/commit/350a86cbbaad43c9c48ccfdebe3d49c3e29fe28a))
* 优化主题切换边框适配 ([668d383](https://github.com/whitexie/ant-chat/commit/668d383c541a67ff18d8317e3954b6288e28edce))


### Features

* 增加`联网搜索`功能(仅Gemini支持) ([174ff77](https://github.com/whitexie/ant-chat/commit/174ff77408bd795935b138954b11815a7d0fd76f))
* refactor chat sender component ([4f0541d](https://github.com/whitexie/ant-chat/commit/4f0541d27c1ea233f6224e2fe9a0084c627c99fa))



# [0.3.0](https://github.com/whitexie/ant-chat/compare/v0.2.1...v0.3.0) (2025-02-18)


### Features

* 附件上传功能增强 ([7f659a5](https://github.com/whitexie/ant-chat/commit/7f659a5cb9c311418de59a6df14ca293c5bd4234))
* 集成 remark-gfm 插件以增强 Markdown 渲染 ([b2e7898](https://github.com/whitexie/ant-chat/commit/b2e78987ebc547928ebdad7c41318194a846ffb8))
* 移动端适配 ([ea4bd19](https://github.com/whitexie/ant-chat/commit/ea4bd19af913fc733a5f9ab493365c6bb3270562))
* 增强消息处理，支持附件上传 ([19c77bc](https://github.com/whitexie/ant-chat/commit/19c77bc9177596bae216149529ac01291c88895b))



## [0.2.1](https://github.com/whitexie/ant-chat/compare/v0.2.0...v0.2.1) (2025-02-14)


### Bug Fixes

* 改进系统提示词和用户消息的展示效果 ([5c5732f](https://github.com/whitexie/ant-chat/commit/5c5732f52919f12fa9ee076c89e4bfa142f2b445))
* 系统提示词消息不支持删除 ([71ade30](https://github.com/whitexie/ant-chat/commit/71ade3039fd466c0f25b84acf2646e9a605197e2))
* 修复AI回答时无法中止 ([94d961b](https://github.com/whitexie/ant-chat/commit/94d961b7786522739af75856095e6d0fd279c79a))
* 修复temperature不生效 ([ce5196f](https://github.com/whitexie/ant-chat/commit/ce5196f135e2b1afcf23eb1124e7c6d61592f311))
* add onPressEnter handler to ConversationsTitle input ([1dc6591](https://github.com/whitexie/ant-chat/commit/1dc65911c9a4e6161301c5092bda8eff43c09bfc))
* decryptData 现在返回原始字符串，不再进行 JSON 解析 ([1e3cc50](https://github.com/whitexie/ant-chat/commit/1e3cc5007d2803cecc5fb1071a30c05046630122))


### Features

* 通过语法高亮和改进的代码块支持增强 Markdown 渲染 ([cf077bf](https://github.com/whitexie/ant-chat/commit/cf077bf46c80b5f6e7b1238fae3886c5b91b1daa))



# [0.2.0](https://github.com/whitexie/ant-chat/compare/v0.1.0...v0.2.0) (2025-02-04)


### Bug Fixes

* 调整ChatMessage ([b615596](https://github.com/whitexie/ant-chat/commit/b6155961ce42039f7b22faefbba63a022d29b867))
* improve conversation title generation robustness ([86a4092](https://github.com/whitexie/ant-chat/commit/86a4092ca85852e379bce3d2f71130ac39002333))
* stream 支持自定义分隔符 ([951a4ff](https://github.com/whitexie/ant-chat/commit/951a4ff0ad9305ee5aff8ab6aea7651a815b6aa4))


### Features

* 加密存储模型配置 ([86f1d38](https://github.com/whitexie/ant-chat/commit/86f1d38dd9fea2250eb81b600b880ed2e0d6a92e))
* 添加基于 Dexie 的 IndexedDB 数据库以存储Conversations 和 Messages ([ae54643](https://github.com/whitexie/ant-chat/commit/ae54643d654729ee6ff7e7280a0757af52a4ce50))
* 增加OpenAIService ([bc8a7b9](https://github.com/whitexie/ant-chat/commit/bc8a7b9fb179b8f1f06036af5c4adbd5c6369e72))
* 支持多AI提供商配置 ([5f7d7b0](https://github.com/whitexie/ant-chat/commit/5f7d7b06fc74f788435b59e36c4faa1ae52d536a))
* 支持设置系统提示词 ([409a607](https://github.com/whitexie/ant-chat/commit/409a607a694ca491d781474d06c57173ae355d38))
* 自动生成会话标题功能 ([93223a7](https://github.com/whitexie/ant-chat/commit/93223a787a7f7629fc958a81888b9cf7247acc61))
* add google gemini services ([2b7174c](https://github.com/whitexie/ant-chat/commit/2b7174c2383fb2a45484e016cbfd0641fecada50))



# [0.1.0](https://github.com/whitexie/ant-chat/compare/v0.0.2...v0.1.0) (2025-01-23)


### Bug Fixes

* 修复ai回复的内容混乱问题 ([487bd4c](https://github.com/whitexie/ant-chat/commit/487bd4cb16f9c478d74fce04373ff3da33d57886))
* 修复Settings的model字段选中值不生效问题 ([82c9de9](https://github.com/whitexie/ant-chat/commit/82c9de9a1b5d38f1c4fee50d13a02bbf056995ca))


### Features

* 根据对话上下文自动生成标题 ([10169e0](https://github.com/whitexie/ant-chat/commit/10169e0b8283ac055baf7680d2f1f5e9543604b7))
* 使用react-markdown 替换markdown-it. 抽离RenameModal组件.优化首屏渲染 ([7db5db6](https://github.com/whitexie/ant-chat/commit/7db5db639dc818c34f6192ee7db458df70747d60))



## [0.0.2](https://github.com/whitexie/ant-chat/compare/v0.0.1...v0.0.2) (2025-01-21)


### Bug Fixes

* 处理聊天消息处理中的错误 ([e6bdb03](https://github.com/whitexie/ant-chat/commit/e6bdb0379aa024fd07a50fb4a98cd1d17ddb698f))
* 发送消息时，同步关闭sender.header窗口 ([4bc16e4](https://github.com/whitexie/ant-chat/commit/4bc16e4e77281660b9d2dd664037b683aaa03d1a))
* 优化发送消息逻辑 ([d79524b](https://github.com/whitexie/ant-chat/commit/d79524b2db2aaf42c336a8a7aec9f343a902bbeb))
* modelConfigStore 增加reset函数 ([f667ce5](https://github.com/whitexie/ant-chat/commit/f667ce5baf4228694e935f669afde90b0055182e))


### Features

* 侧边栏增加版本信息入口 ([cf0ae62](https://github.com/whitexie/ant-chat/commit/cf0ae621fbbf27c7c0e5b858afff6af5528406df))
* 对话气泡增加复制、刷新和删除功能 ([388c49c](https://github.com/whitexie/ant-chat/commit/388c49c60bf916b1672380fa97dd76ed5e59c918))
* 消息气泡增加格式化时间显示 ([2f1deb0](https://github.com/whitexie/ant-chat/commit/2f1deb03b608a3a0402c093ca84450337eb6696b))
* 增加Github的跳转Button ([435a22f](https://github.com/whitexie/ant-chat/commit/435a22fb6f9ec5f759cd8d3c8ea66b2fe4afc4ba))
* conversationStore 状态优化 ([a54fac1](https://github.com/whitexie/ant-chat/commit/a54fac15ef8bd5728dfb461272f1a2b952a2c531))
* convesationsStore 增加 reset 方法，重置Store ([ec5a429](https://github.com/whitexie/ant-chat/commit/ec5a4292b2234358af9cdf4762552ab8fd800b01))
* store初步实现 ([58d9c15](https://github.com/whitexie/ant-chat/commit/58d9c15ad91fb94470fe888aaf6c52bfe7655a35))



## [0.0.1](https://github.com/whitexie/ant-chat/compare/7fbc12020c88b27fe94637cb14e4b4aaa8dec4b5...v0.0.1) (2025-01-16)


### Bug Fixes

* 对话列表溢出 ([3eee011](https://github.com/whitexie/ant-chat/commit/3eee0111739561071c419debadbc1df33e567c77))
* 对话数据同步 ([8b29442](https://github.com/whitexie/ant-chat/commit/8b29442db463c0a6cb7a1eacbdd7c9ef36f31361))
* 修复切换新对话时，对话数据更新异常问题 ([9ebaf4d](https://github.com/whitexie/ant-chat/commit/9ebaf4d4620b76354cca5fd00eee1698974782ae))
* 优化发送消息 ([c452d0f](https://github.com/whitexie/ant-chat/commit/c452d0f5314ac41387265dc856351c8785f88d0a))


### Features

* 对话功能支持发送图片 ([a4b8320](https://github.com/whitexie/ant-chat/commit/a4b8320f69fc4afe7b334f32f1f37daf25979a60))
* 对话管理和黑暗模式 ([d070a27](https://github.com/whitexie/ant-chat/commit/d070a2739a820504f6112de0abcf07d6ce692b35))
* 对话管理增加清空功能 ([482c7d9](https://github.com/whitexie/ant-chat/commit/482c7d9192622743c6103d72ba1975fd1341b762))
* 对话数据 导入/导出 功能 ([1fcd9ea](https://github.com/whitexie/ant-chat/commit/1fcd9ea4853a303dd966200942c1d4c6e9e167f1))
* 对话重命名、删除功能 ([a4d14d2](https://github.com/whitexie/ant-chat/commit/a4d14d2b4e068c5291e78f5931f5aaf74e6398d3))
* 更换图标方案 ([624568c](https://github.com/whitexie/ant-chat/commit/624568cf8e84ca98663cdf497094e46c8a9193d8))
* 更换新logo ([d3636db](https://github.com/whitexie/ant-chat/commit/d3636dbc75459515f46fef3f850c47cf877c2c4e))
* 开启gzip压缩 ([8d6bf92](https://github.com/whitexie/ant-chat/commit/8d6bf9291d2735ef3bd71f55fb9eb97c1e76ac9f))
* 模型支持配置 ([87fcb14](https://github.com/whitexie/ant-chat/commit/87fcb14a6c9efae474d392a5370b0759c6ddbcfb))
* 图标方案使用 @ant-design/icons ([793cd4b](https://github.com/whitexie/ant-chat/commit/793cd4b7971dc666d615f49fc83273a39a6c088b))
* add file system access utilities and update type definitions ([f045b21](https://github.com/whitexie/ant-chat/commit/f045b21bea3f499445b6b903d6b9f77632ef88f2))
* add immer and use-immer dependencies ([6604839](https://github.com/whitexie/ant-chat/commit/66048398619a234d03c2e11990de46b8815f36c7))
* add vitest ([557e836](https://github.com/whitexie/ant-chat/commit/557e836af51e68b4ba59492dace26ba11bdb2d2d))
* first commit ([7fbc120](https://github.com/whitexie/ant-chat/commit/7fbc12020c88b27fe94637cb14e4b4aaa8dec4b5))
* lazy load RenderMarkdown and SettingsModal components ([dc5bc6b](https://github.com/whitexie/ant-chat/commit/dc5bc6be37187a1a2b80a276ddaac2f9f4e33ce6))



