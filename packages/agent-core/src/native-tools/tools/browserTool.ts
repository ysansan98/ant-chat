import type { AgentBrowserRuntimeConfig, BrowserToolInput } from '@ant-chat/shared'
import { runBrowserTool, validateBrowserInput } from './browserRunner'
import { createNativeTool } from './toolFactory'

export function createBrowserTool(workspacePath: string, config: AgentBrowserRuntimeConfig) {
  return createNativeTool({
    name: 'browser',
    description: [
      'Control a persistent browser with agent-browser.',
      'Use command="open" with an HTTP(S) URL, then command="snapshot", interact with @eN refs, and snapshot again after navigation or DOM changes.',
      'Use command="skills get" with args=["core"] for the version-matched detailed guide.',
      'The browser uses one global Ant Chat profile, so login state persists across conversations and workspaces.',
      'Use args=["--headed", ...] when the user must complete login, CAPTCHA, or two-factor authentication.',
      'Never request, accept, or enter account passwords. Open a headed browser and let the user type credentials directly.',
      'Only use args=["--profile", "<Chrome profile name>", ...] when the user explicitly asks to reuse a system Chrome profile.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Allowed agent-browser command, for example open, snapshot, click, get text, or skills get.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments. Do not include shell syntax.' },
        timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds, capped at 300000.' },
      },
      required: ['command'],
    },
    unrestricted: true,
    inferScope: (input) => {
      return validateBrowserInput(input as unknown as BrowserToolInput, {
        workspacePath,
        artifactsPath: config.artifactsPath,
      })
        ? 'blocked'
        : 'workspace'
    },
    validateInput: input => validateBrowserInput(input as unknown as BrowserToolInput, {
      workspacePath,
      artifactsPath: config.artifactsPath,
    }),
    execute: input => runBrowserTool(input as unknown as BrowserToolInput, {
      ...config,
      workspacePath,
    }),
    formatError: error => `Browser tool failed: ${error}`,
    truncateObservation: false,
  })
}
