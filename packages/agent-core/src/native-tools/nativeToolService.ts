import type {
  AgentTool,
  AgentToolResult,
  EditFileToolInput,
  GlobFilesToolInput,
  GrepFilesToolInput,
  ListDirToolInput,
  ReadFileToolInput,
  WriteFileToolInput,
} from '@ant-chat/shared'
import { createPathPolicyByMode } from './pathPolicy'
import { createBashTool } from './tools/bashTool'
import { createBrowserTool } from './tools/browserTool'
import { createEditFileTool, editFile } from './tools/editFileTool'
import { createGlobFilesTool, globFiles } from './tools/globFilesTool'
import { createGrepFilesTool, grepFiles } from './tools/grepFilesTool'
import { createListDirTool, listDir } from './tools/listDirTool'
import { createReadFileTool, readFile } from './tools/readFileTool'
import { createWriteFileTool, writeFile } from './tools/writeFileTool'

interface NativeToolServiceOptions {
  readableRoots?: string[]
  browser?: {
    executablePath: string
    profilePath: string
    artifactsPath: string
  }
}

export class NativeToolService {
  constructor(
    private readonly workspacePath: string,
    private readonly unrestricted: boolean = false,
    private readonly options: NativeToolServiceOptions = {},
  ) {}

  getTools(): AgentTool[] {
    const policy = this.pathPolicy
    return [
      createReadFileTool(policy, this.unrestricted),
      createListDirTool(policy, this.unrestricted),
      createGlobFilesTool(policy, this.unrestricted),
      createGrepFilesTool(policy, this.unrestricted),
      createWriteFileTool(policy, this.workspacePath, this.unrestricted),
      createEditFileTool(policy, this.workspacePath, this.unrestricted),
      createBashTool(this.workspacePath, this.unrestricted),
      ...(this.options.browser
        ? [createBrowserTool(this.workspacePath, this.options.browser)]
        : []),
    ]
  }

  private get pathPolicy() {
    return createPathPolicyByMode(this.workspacePath, this.unrestricted ? 'unrestricted' : 'workspace', this.options.readableRoots ?? [])
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
