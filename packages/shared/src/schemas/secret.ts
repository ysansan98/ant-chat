import { z } from 'zod'

export const SecretScopeSchema = z.enum(['persistent', 'turn'])

export const SecretRefSchema = z.object({
  kind: z.literal('secret_ref'),
  id: z.string(),
  scope: SecretScopeSchema,
})

export const SecretRequestFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
})

export const SecretRequestSchema = z.object({
  requestId: z.string(),
  automationRunId: z.string().optional(),
  runId: z.string(),
  conversationId: z.string(),
  label: z.string(),
  fields: z.array(SecretRequestFieldSchema),
  reason: z.string().optional(),
  createdAt: z.number(),
})

export const SecretRequestResultSchema = z.object({
  secretRef: SecretRefSchema.optional(),
  secretRefs: z.record(z.string(), SecretRefSchema),
})

export type SecretScope = z.infer<typeof SecretScopeSchema>
export type SecretRef = z.infer<typeof SecretRefSchema>
export type SecretRequestField = z.infer<typeof SecretRequestFieldSchema>
export type SecretRequest = z.infer<typeof SecretRequestSchema>
export type SecretRequestResult = z.infer<typeof SecretRequestResultSchema>
