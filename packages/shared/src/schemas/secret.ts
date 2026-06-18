import { z } from 'zod'

export const SecretScopeSchema = z.enum(['persistent', 'turn'])

export const SecretRefSchema = z.object({
  kind: z.literal('secret_ref'),
  id: z.string(),
  scope: SecretScopeSchema,
})

export const SecretRequestSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  conversationId: z.string(),
  label: z.string(),
  reason: z.string().optional(),
  createdAt: z.number(),
})

export type SecretScope = z.infer<typeof SecretScopeSchema>
export type SecretRef = z.infer<typeof SecretRefSchema>
export type SecretRequest = z.infer<typeof SecretRequestSchema>
