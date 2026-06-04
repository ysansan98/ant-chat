import type { CompactionStrategy, IAIProvider } from '@ant-chat/shared'

const SUMMARIZATION_SYSTEM_PROMPT = `You compress prior agent conversation history so the task can continue accurately.

Summarize only the provided conversation. Do not infer facts that are not present.
If a section has no evidence, write "None" or "Unknown".

Output exactly these sections:

## User goal
The user's final objective and any explicit constraints or preferences that still apply.

## Completed work
Concrete completed actions only. Include changed files, commands run, command results, and verification status.

## Current state
What the agent was doing when this history ended. Include pending edits, running commands, unresolved errors, and blockers.

## Decisions
Important implementation decisions and the reason recorded in the conversation.

## Next actions
Actionable next steps needed to continue the task.

## Critical context
Preserve exact file paths, commands, identifiers, versions, ports, URLs, error messages, test names, branch names, commit hashes, and user instructions.

Rules:
- Preserve exact literals. Do not rewrite paths, commands, identifiers, or error messages.
- Do not mark planned work as completed.
- Do not omit failing checks or unverified work.
- Do not include commentary before or after the summary.`

const MAX_SUMMARY_TOKENS = 3200

export function createCompactionStrategy(): CompactionStrategy {
  return {
    async summarize(serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal, instruction?: string) {
      const instructionBlock = instruction
        ? [
            '',
            '<user-instruction>',
            'The user provided the following guidance for this compression. Prioritize preserving content relevant to the instruction and feel free to omit content the instruction says to ignore:',
            instruction,
            '</user-instruction>',
          ].join('\n')
        : ''

      const userMessage = [
        'Compress the following prior conversation history into a structured continuation summary:',
        instructionBlock,
        '',
        '<conversation>',
        serialized,
        '</conversation>',
      ].join('\n')

      const result = await aiProvider.complete({
        messages: [{ role: 'user', content: userMessage }],
        chatSettings: {
          model,
          systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
          maxTokens: MAX_SUMMARY_TOKENS,
        },
        abortSignal,
      })
      return result.text
    },
  }
}
