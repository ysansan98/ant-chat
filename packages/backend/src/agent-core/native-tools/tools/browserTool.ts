import type { AgentBrowserRuntimeConfig, BrowserToolInput } from '@ant-chat/shared'
import type { BrowserSessionState } from './browserSessionManager'
import { runBrowserTool, validateBrowserInput } from './browserRunner'
import { createNativeTool } from './toolFactory'

export function createBrowserTool(workspacePath: string, config: AgentBrowserRuntimeConfig, state: BrowserSessionState) {
  return createNativeTool({
    name: 'browser',
    description: [
      'Control a persistent browser with agent-browser.',
      'The browser session is isolated per conversation and reused across all turns in that conversation.',
      'Use command="open" with an HTTP(S) URL, then command="snapshot", interact with @eN refs, and snapshot again after navigation or DOM changes.',
      'Use command="eval" only when snapshots and semantic element commands cannot access the required page content.',
      'Each conversation has an isolated persistent profile, so login state survives later turns and app restarts without profile lock conflicts.',
      'Use args=["--headed", ...] when the user must complete login, CAPTCHA, or two-factor authentication.',
      'Never request, accept, or enter account passwords. Open a headed browser and let the user type credentials directly.',
      'Only use args=["--profile", "<Chrome profile name>", ...] when the user explicitly asks to reuse a system Chrome profile.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Allowed agent-browser command, for example open, snapshot, click, get text, or eval.' },
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
      proxyUrl: config.proxyUrl,
      state,
    }),
    truncateResult: false,
  })
}
