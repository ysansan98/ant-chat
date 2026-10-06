import type {
  AgentCommandHost,
  AgentTool,
  AgentToolResult,
  AgentTurnSource,
  BrowserAuthStateProvider,
  ChannelAttachmentSender,
  EditFileToolInput,
  GlobFilesToolInput,
  GrepFilesToolInput,
  ListDirToolInput,
  ReadFileToolInput,
  SecretStore,
  WriteFileToolInput,
} from '@ant-chat/shared'
import type { BackgroundCommandManager } from './command/backgroundCommandManager'
import type { BrowserSessionState } from './tools/browserSessionManager'
import os from 'node:os'
import path from 'node:path'
import { createBackgroundCommandTools } from './command/backgroundCommandTools'
import { createCommandTool } from './command/commandTool'
import { createPathPolicyByMode } from './pathPolicy'
import { createBrowserBackTool, createBrowserClickTool, createBrowserCloseTool, createBrowserDialogTool, createBrowserEvalTool, createBrowserNavigateTool, createBrowserPressTool, createBrowserReloadTool, createBrowserScrollTool, createBrowserSnapshotTool, createBrowserTypeTool } from './tools/browserTool'
import { createEditFileTool, editFile } from './tools/editFileTool'
import { createGlobFilesTool, globFiles } from './tools/globFilesTool'
import { createGrepFilesTool, grepFiles } from './tools/grepFilesTool'
import { createListDirTool, listDir } from './tools/listDirTool'
import { createReadFileTool, readFile } from './tools/readFileTool'
import { createSendAttachmentTool } from './tools/sendAttachmentTool'
import { createWriteFileTool, writeFile } from './tools/writeFileTool'

interface NativeToolServiceOptions {
  trustedPaths?: string[]
  browser?: {
    artifactsPath: string
    proxyUrl?: string
    env?: Readonly<Record<string, string>>
  }
  browserSession?: BrowserSessionState
  browserAuthState?: BrowserAuthStateProvider
  commandHost?: AgentCommandHost
  /** 会话级后台命令管理器；提供后注册 read_command_output/kill_command/list_commands。 */
  backgroundCommands?: BackgroundCommandManager
  /** 当前会话 id；后台命令按会话隔离。 */
  conversationId?: string
  secretStore?: SecretStore
  runId?: string
  turnSource?: AgentTurnSource
  channelAttachmentSender?: ChannelAttachmentSender
}

export class NativeToolService {
  constructor(
    private readonly workspacePath: string,
    private readonly unrestricted: boolean = false,
    private readonly options: NativeToolServiceOptions = {},
  ) {}

  getTools(): AgentTool[] {
    const policy = this.pathPolicy
    const browserSession = this.options.browserSession ?? {
      sessionName: 'ant-chat-direct',
      socketPath: path.join(os.tmpdir(), 'ant-chat-direct'),
      headed: false,
      started: false,
      profile: undefined,
      queue: Promise.resolve(),
      authGeneration: this.options.browserAuthState?.getGeneration() ?? 0,
      authCookies: this.options.browserAuthState?.getCookies() ?? undefined,
      authSnapshotReady: this.options.browserAuthState?.isInitialized?.() ?? true,
    }
    const browserFactoryOptions = this.options.browser
      ? {
          workspacePath: this.workspacePath,
          config: this.options.browser,
          state: browserSession,
          authStateProvider: this.options.browserAuthState,
        }
      : undefined
    return [
      createReadFileTool(policy, this.unrestricted),
      createSendAttachmentTool(policy, this.unrestricted, {
        turnSource: this.options.turnSource,
        channelAttachmentSender: this.options.channelAttachmentSender,
      }),
      createListDirTool(policy, this.unrestricted),
      createGlobFilesTool(policy, this.unrestricted),
      createGrepFilesTool(policy, this.unrestricted),
      createWriteFileTool(policy, this.workspacePath, this.unrestricted),
      createEditFileTool(policy, this.workspacePath, this.unrestricted),
      ...(this.options.commandHost?.status === 'available'
        ? [createCommandTool(this.workspacePath, this.unrestricted, this.options.commandHost, {
            blockAgentBrowser: Boolean(this.options.browser),
            secretStore: this.options.secretStore,
            runId: this.options.runId,
            trustedPaths: this.options.trustedPaths ?? [],
            backgroundCommands: this.options.backgroundCommands,
            conversationId: this.options.conversationId,
          })]
        : []),
      ...(this.options.commandHost?.status === 'available' && this.options.backgroundCommands && this.options.conversationId
        ? createBackgroundCommandTools({
            manager: this.options.backgroundCommands,
            conversationId: this.options.conversationId,
          })
        : []),
      ...(browserFactoryOptions
        ? [
            createBrowserNavigateTool(browserFactoryOptions),
            createBrowserBackTool(browserFactoryOptions),
            createBrowserReloadTool(browserFactoryOptions),
            createBrowserCloseTool(browserFactoryOptions),
            createBrowserSnapshotTool(browserFactoryOptions),
            createBrowserClickTool(browserFactoryOptions),
            createBrowserTypeTool(browserFactoryOptions),
            createBrowserPressTool(browserFactoryOptions),
            createBrowserScrollTool(browserFactoryOptions),
            createBrowserDialogTool(browserFactoryOptions),
            createBrowserEvalTool(browserFactoryOptions),
          ]
        : []),
    ]
  }

  private get pathPolicy() {
    return createPathPolicyByMode(this.workspacePath, this.unrestricted ? 'unrestricted' : 'workspace', this.options.trustedPaths ?? [])
  }

  async readFile(input: ReadFileToolInput): Promise<AgentToolResult> {
    return readFile(input, this.pathPolicy)
  }

  async listDir(input: ListDirToolInput = {}): Promise<AgentToolResult> {
    return listDir(input, this.pathPolicy)
  }

  async globFiles(input: GlobFilesToolInput): Promise<AgentToolResult> {
    return globFiles(input, this.pathPolicy)
  }

  async grepFiles(input: GrepFilesToolInput): Promise<AgentToolResult> {
    return grepFiles(input, this.pathPolicy)
  }

  async writeFile(input: WriteFileToolInput): Promise<AgentToolResult> {
    return writeFile(input, this.pathPolicy, this.workspacePath)
  }

  async editFile(input: EditFileToolInput): Promise<AgentToolResult> {
    return editFile(input, this.pathPolicy, this.workspacePath)
  }
}

export function getNativeToolService(
  workspacePath: string,
  unrestricted: boolean = false,
  options: NativeToolServiceOptions = {},
): NativeToolService {
  return new NativeToolService(workspacePath, unrestricted, options)
}
