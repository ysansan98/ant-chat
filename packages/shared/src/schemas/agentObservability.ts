import { z } from 'zod'
import { AutomationPermissionPolicySchema } from './automation'

export const AGENT_OBSERVABILITY_SCHEMA_VERSION = 1 as const

export const AgentTurnSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interactive') }),
  z.object({
    type: z.literal('automation'),
    automationId: z.string().min(1),
    runId: z.string().min(1),
    allowedSkills: z.array(z.string()),
    allowedMcpServers: z.array(z.string()),
    permissionPolicy: AutomationPermissionPolicySchema,
  }),
])
export const AgentTurnStatusSchema = z.enum(['success', 'failed', 'cancelled', 'interrupted'])
export const AgentTurnLifecycleSchema = z.enum(['collecting', 'completed'])
export const TraceCompletenessSchema = z.enum(['complete', 'incomplete'])
export const AgentTraceAvailabilitySchema = z.enum(['available', 'unsupported', 'expired', 'not-collected'])
export const TraceIncompleteReasonSchema = z.enum(['disk', 'queue-overflow', 'corrupt-delta', 'missing-terminal', 'span-mismatch'])
export const TraceSpanKindSchema = z.enum(['model-request', 'policy-decision', 'tool-call'])
export const TraceSpanStatusSchema = z.enum([
  'success',
  'failed',
  'cancelled',
  'allow',
  'block',
  'approval',
  'blocked',
])
export const ContextEventKindSchema = z.enum(['compaction', 'steering', 'history-rewrite'])
export const PolicyBasisSchema = z.enum([
  'mode.full-managed',
  'scope.blocked',
  'scope.outside',
  'workspace.read',
  'hybrid.write',
  'default.require-approval',
  'approval-grant.match',
  'approval.user-approved',
  'approval.user-rejected',
  'automation.no-policy',
  'automation.scope.blocked',
  'automation.read.allow',
  'automation.browser.allow',
  'automation.write.allow',
  'automation.write.blocked',
  'automation.skill.allow',
  'automation.bash-read.allow',
  'automation.bash-read.blocked',
  'automation.mcp.allow',
  'automation.mcp.blocked',
  'automation.bash.allow',
  'automation.bash.blocked',
  'automation.bash.pattern-match',
  'automation.bash.pattern-blocked',
  'automation.unsupported',
])

const TraceRecordEnvelopeSchema = z.object({
  schemaVersion: z.literal(AGENT_OBSERVABILITY_SCHEMA_VERSION),
  sequence: z.number().int().nonnegative(),
  recordedAt: z.number().nonnegative(),
  traceId: z.string().min(1),
  recordId: z.string().min(1),
})

export const TraceStartedRecordSchema = TraceRecordEnvelopeSchema.extend({
  recordType: z.literal('trace-started'),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  source: AgentTurnSourceSchema,
  taskId: z.string().min(1).optional(),
  startedAt: z.number().nonnegative(),
  metadata: z.unknown().optional(),
})

export const SpanStartedRecordSchema = TraceRecordEnvelopeSchema.extend({
  recordType: z.literal('span-started'),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  spanKind: TraceSpanKindSchema,
  startedAt: z.number().nonnegative(),
  input: z.unknown(),
})

export const SpanCompletedRecordSchema = TraceRecordEnvelopeSchema.extend({
  recordType: z.literal('span-completed'),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  spanKind: TraceSpanKindSchema,
  status: TraceSpanStatusSchema,
  endedAt: z.number().nonnegative(),
  output: z.unknown().optional(),
  error: z.unknown().optional(),
})

export const ContextEventRecordSchema = TraceRecordEnvelopeSchema.extend({
  recordType: z.literal('context-event'),
  eventKind: ContextEventKindSchema,
  evidence: z.unknown(),
})

export const TraceIncompleteRecordSchema = TraceRecordEnvelopeSchema.extend({
  recordType: z.literal('trace-incomplete'),
  reason: TraceIncompleteReasonSchema,
  firstDroppedSequence: z.number().int().nonnegative().optional(),
  lastDroppedSequence: z.number().int().nonnegative().optional(),
  details: z.string().optional(),
})

export const TraceCompletedRecordSchema = TraceRecordEnvelopeSchema.extend({
  recordType: z.literal('trace-completed'),
  status: AgentTurnStatusSchema,
  endedAt: z.number().nonnegative(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})

export const AgentObservabilityRecordSchema = z.discriminatedUnion('recordType', [
  TraceStartedRecordSchema,
  SpanStartedRecordSchema,
  SpanCompletedRecordSchema,
  ContextEventRecordSchema,
  TraceIncompleteRecordSchema,
  TraceCompletedRecordSchema,
])

export const AgentTurnSpanCountsSchema = z.object({
  modelRequests: z.number().int().nonnegative(),
  policyDecisions: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  contextEvents: z.number().int().nonnegative(),
})

const AgentTurnSummaryIdentitySchema = z.object({
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
})

const AvailableAgentTurnSummaryBaseSchema = AgentTurnSummaryIdentitySchema.extend({
  availability: z.literal('available'),
  traceId: z.string().min(1),
  source: AgentTurnSourceSchema,
  taskId: z.string().min(1).optional(),
  startedAt: z.number().nonnegative(),
  spanCounts: AgentTurnSpanCountsSchema,
})

export const CollectingAgentTurnSummarySchema = AvailableAgentTurnSummaryBaseSchema.extend({
  lifecycle: z.literal('collecting'),
  status: z.never().optional(),
  completeness: z.never().optional(),
  incompleteReasons: z.never().optional(),
  endedAt: z.never().optional(),
  durationMs: z.never().optional(),
  errorSummary: z.never().optional(),
})

export const CompletedAgentTurnSummarySchema = AvailableAgentTurnSummaryBaseSchema.extend({
  lifecycle: z.literal('completed'),
  status: AgentTurnStatusSchema,
  completeness: TraceCompletenessSchema,
  incompleteReasons: z.array(TraceIncompleteReasonSchema),
  endedAt: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  errorSummary: z.string().min(1).optional(),
})

export const AvailableAgentTurnSummarySchema = z.discriminatedUnion('lifecycle', [
  CollectingAgentTurnSummarySchema,
  CompletedAgentTurnSummarySchema,
])

export const UnavailableAgentTurnSummarySchema = AgentTurnSummaryIdentitySchema.extend({
  availability: z.enum(['unsupported', 'expired', 'not-collected']),
  traceId: z.string().min(1).optional(),
  message: z.string().optional(),
})

export const AgentTurnSummarySchema = z.union([
  AvailableAgentTurnSummarySchema,
  UnavailableAgentTurnSummarySchema,
])

export const AgentTraceSpanSchema = z.object({
  type: z.literal('span'),
  recordId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  kind: TraceSpanKindSchema,
  status: TraceSpanStatusSchema.optional(),
  startedAt: z.number().nonnegative(),
  endedAt: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** 由查询端生成，保证时间线列表无需读取原始证据即可展示。 */
  summary: z.string().optional(),
})

export const AgentTraceContextEventSchema = z.object({
  type: z.literal('context-event'),
  recordId: z.string().min(1),
  kind: ContextEventKindSchema,
  recordedAt: z.number().nonnegative(),
})

export const AgentTurnTimelineItemSchema = z.discriminatedUnion('type', [
  AgentTraceSpanSchema,
  AgentTraceContextEventSchema,
])

export const AgentTurnTimelineSchema = z.object({
  summary: CompletedAgentTurnSummarySchema,
  items: z.array(AgentTurnTimelineItemSchema),
})

export const AgentObservabilityEvidenceSchema = z.object({
  recordId: z.string().min(1),
  records: z.array(AgentObservabilityRecordSchema).min(1),
})

export interface AgentTurnIdentity { conversationId: string, turnId: string }

export type AgentObservabilityTurnSource = z.infer<typeof AgentTurnSourceSchema>
export type AgentTurnStatus = z.infer<typeof AgentTurnStatusSchema>
export type AgentTurnLifecycle = z.infer<typeof AgentTurnLifecycleSchema>
export type TraceCompleteness = z.infer<typeof TraceCompletenessSchema>
export type AgentTraceAvailability = z.infer<typeof AgentTraceAvailabilitySchema>
export type TraceIncompleteReason = z.infer<typeof TraceIncompleteReasonSchema>
export type TraceSpanKind = z.infer<typeof TraceSpanKindSchema>
export type TraceSpanStatus = z.infer<typeof TraceSpanStatusSchema>
export type PolicyBasis = z.infer<typeof PolicyBasisSchema>
export type ContextEventKind = z.infer<typeof ContextEventKindSchema>
export type AgentObservabilityRecord = z.infer<typeof AgentObservabilityRecordSchema>
export type AgentObservabilityRecordInput = AgentObservabilityRecord extends infer TRecord
  ? TRecord extends AgentObservabilityRecord
    ? Omit<TRecord, 'schemaVersion' | 'sequence' | 'recordedAt' | 'traceId' | 'recordId'>
    : never
  : never
export type AvailableAgentTurnSummary = z.infer<typeof AvailableAgentTurnSummarySchema>
export type CollectingAgentTurnSummary = z.infer<typeof CollectingAgentTurnSummarySchema>
export type CompletedAgentTurnSummary = z.infer<typeof CompletedAgentTurnSummarySchema>
export type AgentTurnSummary = z.infer<typeof AgentTurnSummarySchema>
export type AgentTraceSpan = z.infer<typeof AgentTraceSpanSchema>
export type AgentTraceContextEvent = z.infer<typeof AgentTraceContextEventSchema>
export type AgentTurnTimelineItem = z.infer<typeof AgentTurnTimelineItemSchema>
export type AgentTurnTimeline = z.infer<typeof AgentTurnTimelineSchema>
export type AgentObservabilityEvidence = z.infer<typeof AgentObservabilityEvidenceSchema>
