import type {
  AgentCommandHost,
  AgentTool,
  AgentToolResult,
  EditFileToolInput,
  GlobFilesToolInput,
  GrepFilesToolInput,
  ListDirToolInput,
  ReadFileToolInput,
  SecretStore,
  WriteFileToolInput,
} from '@ant-chat/shared'
import type { BrowserSessionState } from './tools/browserSessionManager'
import os from 'node:os'
import path from 'node:path'
import { createCommandTool } from './command/commandTool'
import { createPathPolicyByMode } from './pathPolicy'
import { createBrowserTool } from './tools/browserTool'
import { createEditFileTool, editFile } from './tools/editFileTool'
import { createGlobFilesTool, globFiles } from './tools/globFilesTool'
import { createGrepFilesTool, grepFiles } from './tools/grepFilesTool'
import { createListDirTool, listDir } from './tools/listDirTool'
import { createReadFileTool, readFile } from './tools/readFileTool'
import { createWriteFileTool, writeFile } from './tools/writeFileTool'

interface NativeToolServiceOptions {
  trustedPaths?: string[]
  browser?: {
    profilePath: string
    artifactsPath: string
    proxyUrl?: string
  }
  browserSession?: BrowserSessionState
  commandHost?: AgentCommandHost
  secretStore?: SecretStore
  runId?: string
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
      profilePath: this.options.browser?.profilePath ?? '',
      headed: false,
      started: false,
      profile: undefined,
      queue: Promise.resolve(),
    }
    return [
      createReadFileTool(policy, this.unrestricted),
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
          })]
        : []),
      ...(this.options.browser
        ? [createBrowserTool(this.workspacePath, this.options.browser, browserSession)]
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
