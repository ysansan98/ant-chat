import { z } from 'zod'

export const AutomationScheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('once'), runAt: z.number().int().positive() }),
  z.object({ type: z.literal('cron'), expression: z.string().trim().min(1), timezone: z.string().trim().min(1) }),
])

export const AutomationPermissionPolicySchema = z.object({
  workspaceAccess: z.enum(['read', 'write']).default('read'),
  allowSelectedSkillRuntime: z.boolean().default(false),
  allowBrowser: z.boolean().default(false),
  allowMcpTools: z.boolean().default(false),
  extraFileRoots: z.array(z.string()).default([]),
  allowCommandExecution: z.boolean().default(false),
  commandPatterns: z.array(z.string()).default([]),
}).strict()

export const AutomationInputSchema = z.object({
  name: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  allowedSkills: z.array(z.string()).default([]),
  allowedMcpServers: z.array(z.string()).default([]),
  permissionPolicy: AutomationPermissionPolicySchema,
  schedule: AutomationScheduleSchema,
  enabled: z.boolean().default(true),
})

export type AutomationSchedule = z.infer<typeof AutomationScheduleSchema>
export type AutomationPermissionPolicy = z.infer<typeof AutomationPermissionPolicySchema>
export type AutomationInput = z.infer<typeof AutomationInputSchema>
