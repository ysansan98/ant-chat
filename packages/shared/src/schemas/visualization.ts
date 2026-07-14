import { z } from 'zod'

export const VISUALIZATION_FORMAT = 'ant-chat.visualization.v1' as const

export const VISUALIZATION_LIMITS = {
  maxBytes: 512 * 1024,
  maxDepth: 12,
  maxNodes: 1_000,
  maxRows: 10_000,
  maxStringLength: 4_000,
  maxDatasetCount: 100,
  maxFieldsPerRow: 100,
  maxViews: 100,
  maxActions: 100,
  maxFormFields: 100,
} as const

const MAX_ID_LENGTH = 120
const MAX_LABEL_LENGTH = 240
const MAX_TRANSPORT_DATA_LENGTH = Math.ceil(VISUALIZATION_LIMITS.maxBytes / 3) * 4 + 16

const unsafeStringPattern = /(?:^|\s)(?:https?:\/\/|wss?:\/\/|data:|javascript:)/i
const rawMarkupPattern = /<\/?[a-z][^>]*>/i

const safeString = z.string()
  .max(VISUALIZATION_LIMITS.maxStringLength)
  .refine(value => !unsafeStringPattern.test(value), '可视化 DSL 不支持 URL 或脚本协议')
  .refine(value => !rawMarkupPattern.test(value), '可视化 DSL 不支持原始 HTML/XML 标记')

const identifier = safeString.regex(/^[A-Z][\w-]*$/i, '标识符格式无效')
const shortIdentifier = identifier.max(MAX_ID_LENGTH)
const finiteNumber = z.number().finite()
const scalar = z.union([safeString, finiteNumber, z.boolean(), z.null()])

const dataRow = z.record(shortIdentifier, scalar).superRefine((row, ctx) => {
  if (Object.keys(row).length > VISUALIZATION_LIMITS.maxFieldsPerRow) {
    ctx.addIssue({ code: 'custom', message: `单行字段数不能超过 ${VISUALIZATION_LIMITS.maxFieldsPerRow}` })
  }
})

export const VisualizationDataSchema = z.record(
  shortIdentifier,
  z.array(dataRow).max(VISUALIZATION_LIMITS.maxRows),
).superRefine((datasets, ctx) => {
  if (Object.keys(datasets).length > VISUALIZATION_LIMITS.maxDatasetCount) {
    ctx.addIssue({ code: 'custom', message: `数据集数量不能超过 ${VISUALIZATION_LIMITS.maxDatasetCount}` })
  }
})

export type VisualizationData = z.infer<typeof VisualizationDataSchema>

const stateNumber = z.object({
  type: z.literal('number'),
  initial: finiteNumber,
}).strict()

const stateString = z.object({
  type: z.literal('string'),
  initial: safeString,
}).strict()

const stateBoolean = z.object({
  type: z.literal('boolean'),
  initial: z.boolean(),
}).strict()

export const VisualizationStateSchema = z.discriminatedUnion('type', [
  stateNumber,
  stateString,
  stateBoolean,
])

export const VisualizationStateMapSchema = z.record(shortIdentifier, VisualizationStateSchema)
  .superRefine((state, ctx) => {
    if (Object.keys(state).length > VISUALIZATION_LIMITS.maxNodes) {
      ctx.addIssue({ code: 'custom', message: `状态节点数不能超过 ${VISUALIZATION_LIMITS.maxNodes}` })
    }
  })

export type VisualizationState = z.infer<typeof VisualizationStateSchema>
export type VisualizationStateMap = z.infer<typeof VisualizationStateMapSchema>

export const VisualizationDataRefSchema = z.object({
  type: z.literal('data'),
  dataset: shortIdentifier,
  field: shortIdentifier.optional(),
}).strict()

export const VisualizationStateRefSchema = z.object({
  type: z.literal('state'),
  key: shortIdentifier,
}).strict()

export const VisualizationLiteralSchema = z.object({
  type: z.literal('literal'),
  value: scalar,
}).strict()

export type VisualizationExpression
  = | z.infer<typeof VisualizationDataRefSchema>
    | z.infer<typeof VisualizationStateRefSchema>
    | z.infer<typeof VisualizationLiteralSchema>
    | { type: 'not', operand: VisualizationExpression }
    | { type: 'and' | 'or', operands: VisualizationExpression[] }
    | { type: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte', left: VisualizationExpression, right: VisualizationExpression }
    | { type: 'add' | 'subtract' | 'multiply' | 'divide', left: VisualizationExpression, right: VisualizationExpression }
    | { type: 'sum' | 'avg', dataset: string, field: string, filter?: VisualizationExpression }

const expressionSchema: z.ZodType<VisualizationExpression> = z.lazy(() => z.discriminatedUnion('type', [
  VisualizationDataRefSchema,
  VisualizationStateRefSchema,
  VisualizationLiteralSchema,
  z.object({ type: z.literal('not'), operand: expressionSchema }).strict(),
  z.object({
    type: z.enum(['and', 'or']),
    operands: z.array(expressionSchema).min(1).max(20),
  }).strict(),
  z.object({
    type: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
    left: expressionSchema,
    right: expressionSchema,
  }).strict(),
  z.object({
    type: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: expressionSchema,
    right: expressionSchema,
  }).strict(),
  z.object({
    type: z.enum(['sum', 'avg']),
    dataset: shortIdentifier,
    field: shortIdentifier,
    filter: expressionSchema.optional(),
  }).strict(),
]))

export const VisualizationExpressionSchema = expressionSchema
export const VisualizationFilterSchema = expressionSchema

export type VisualizationExpressionSchemaType = z.infer<typeof VisualizationExpressionSchema>

const validationSchema = z.object({
  min: finiteNumber.optional(),
  max: finiteNumber.optional(),
  minLength: z.number().int().min(0).max(VISUALIZATION_LIMITS.maxStringLength).optional(),
  maxLength: z.number().int().min(0).max(VISUALIZATION_LIMITS.maxStringLength).optional(),
}).strict().superRefine((validation, ctx) => {
  if (validation.min !== undefined && validation.max !== undefined && validation.min > validation.max) {
    ctx.addIssue({ code: 'custom', path: ['max'], message: 'max 不能小于 min' })
  }
  if (validation.minLength !== undefined && validation.maxLength !== undefined && validation.minLength > validation.maxLength) {
    ctx.addIssue({ code: 'custom', path: ['maxLength'], message: 'maxLength 不能小于 minLength' })
  }
})

export const VisualizationFormFieldSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('range'),
    id: shortIdentifier,
    label: safeString.max(MAX_LABEL_LENGTH),
    helpText: safeString.max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    validation: validationSchema.optional(),
    min: finiteNumber,
    max: finiteNumber,
    step: finiteNumber.positive().optional(),
    initial: finiteNumber,
  }).strict().superRefine((field, ctx) => {
    if (field.min > field.max || field.initial < field.min || field.initial > field.max) {
      ctx.addIssue({ code: 'custom', message: 'range 字段的 min、max、initial 范围无效' })
    }
  }),
  z.object({
    type: z.literal('checkbox'),
    id: shortIdentifier,
    label: safeString.max(MAX_LABEL_LENGTH),
    helpText: safeString.max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    validation: validationSchema.optional(),
    initial: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('toggle'),
    id: shortIdentifier,
    label: safeString.max(MAX_LABEL_LENGTH),
    helpText: safeString.max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    validation: validationSchema.optional(),
    initial: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('select'),
    id: shortIdentifier,
    label: safeString.max(MAX_LABEL_LENGTH),
    helpText: safeString.max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    validation: validationSchema.optional(),
    options: z.array(z.object({ value: safeString.max(MAX_LABEL_LENGTH), label: safeString.max(MAX_LABEL_LENGTH) }).strict()).min(1).max(50),
    initial: safeString.max(MAX_LABEL_LENGTH).optional(),
  }).strict(),
  z.object({
    type: z.literal('radio'),
    id: shortIdentifier,
    label: safeString.max(MAX_LABEL_LENGTH),
    helpText: safeString.max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    validation: validationSchema.optional(),
    options: z.array(z.object({ value: safeString.max(MAX_LABEL_LENGTH), label: safeString.max(MAX_LABEL_LENGTH) }).strict()).min(1).max(50),
    initial: safeString.max(MAX_LABEL_LENGTH).optional(),
  }).strict(),
  z.object({
    type: z.literal('text'),
    id: shortIdentifier,
    label: safeString.max(MAX_LABEL_LENGTH),
    helpText: safeString.max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    validation: validationSchema.optional(),
    placeholder: safeString.max(MAX_LABEL_LENGTH).optional(),
    initial: safeString.optional(),
  }).strict(),
  z.object({
    type: z.literal('textarea'),
    id: shortIdentifier,
    label: safeString.max(MAX_LABEL_LENGTH),
    helpText: safeString.max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    validation: validationSchema.optional(),
    placeholder: safeString.max(MAX_LABEL_LENGTH).optional(),
    initial: safeString.optional(),
  }).strict(),
])

export type VisualizationFormField = z.infer<typeof VisualizationFormFieldSchema>

export const PromptTemplateTextSchema = z.object({
  type: z.literal('text'),
  text: safeString,
}).strict()

export const PromptTemplateFieldSchema = z.object({
  type: z.literal('field'),
  fieldId: shortIdentifier,
}).strict()

export const PromptTemplateNodeSchema = z.discriminatedUnion('type', [
  PromptTemplateTextSchema,
  PromptTemplateFieldSchema,
])

export const PromptTemplateAstSchema = z.array(PromptTemplateNodeSchema).min(1).max(100)
export type PromptTemplateAst = z.infer<typeof PromptTemplateAstSchema>
export type PromptTemplateNode = z.infer<typeof PromptTemplateNodeSchema>

export const VisualizationLayoutSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stack'), gap: z.number().int().min(0).max(48).optional() }).strict(),
  z.object({ type: z.literal('grid'), columns: z.number().int().min(1).max(4), gap: z.number().int().min(0).max(48).optional() }).strict(),
])

export type VisualizationLayout = z.infer<typeof VisualizationLayoutSchema>

const viewBase = {
  id: shortIdentifier,
  title: safeString.max(MAX_LABEL_LENGTH).optional(),
  summary: safeString.max(MAX_LABEL_LENGTH).optional(),
  filter: expressionSchema.optional(),
}

const chartView = z.object({
  ...viewBase,
  type: z.enum(['line', 'bar', 'area', 'scatter', 'stacked-bar']),
  dataset: shortIdentifier,
  x: shortIdentifier,
  y: z.array(shortIdentifier).min(1).max(6),
  xLabel: safeString.max(MAX_LABEL_LENGTH).optional(),
  yLabel: safeString.max(MAX_LABEL_LENGTH).optional(),
  unit: safeString.max(80).optional(),
}).strict()

const tableView = z.object({
  ...viewBase,
  type: z.literal('table'),
  dataset: shortIdentifier,
  columns: z.array(z.object({ key: shortIdentifier, label: safeString.max(MAX_LABEL_LENGTH) }).strict()).min(1).max(20),
}).strict()

const categoryGridView = z.object({
  ...viewBase,
  type: z.literal('category-grid'),
  dataset: shortIdentifier,
  category: shortIdentifier,
  value: shortIdentifier.optional(),
}).strict()

const timelineView = z.object({
  ...viewBase,
  type: z.literal('timeline'),
  dataset: shortIdentifier,
  start: shortIdentifier,
  end: shortIdentifier.optional(),
  label: shortIdentifier,
}).strict()

const swimlaneView = z.object({
  ...viewBase,
  type: z.literal('swimlane'),
  dataset: shortIdentifier,
  lane: shortIdentifier,
  start: shortIdentifier,
  end: shortIdentifier,
  label: shortIdentifier,
}).strict()

const flowView = z.object({
  ...viewBase,
  type: z.literal('flow'),
  nodes: z.array(z.object({ id: shortIdentifier, label: safeString.max(MAX_LABEL_LENGTH) }).strict()).min(1).max(VISUALIZATION_LIMITS.maxNodes),
  edges: z.array(z.object({ from: shortIdentifier, to: shortIdentifier, label: safeString.max(MAX_LABEL_LENGTH).optional() }).strict()).max(VISUALIZATION_LIMITS.maxNodes),
}).strict()

const stateMachineView = z.object({
  ...viewBase,
  type: z.literal('state-machine'),
  states: z.array(z.object({ id: shortIdentifier, label: safeString.max(MAX_LABEL_LENGTH) }).strict()).min(1).max(VISUALIZATION_LIMITS.maxNodes),
  transitions: z.array(z.object({ from: shortIdentifier, to: shortIdentifier, event: safeString.max(MAX_LABEL_LENGTH).optional() }).strict()).max(VISUALIZATION_LIMITS.maxNodes),
  initialState: shortIdentifier,
}).strict()

const playerView = z.object({
  ...viewBase,
  type: z.literal('player'),
  steps: z.array(z.object({ id: shortIdentifier, label: safeString.max(MAX_LABEL_LENGTH), state: expressionSchema.optional() }).strict()).min(1).max(VISUALIZATION_LIMITS.maxNodes),
  initialStep: shortIdentifier,
}).strict()

const formView = z.object({
  ...viewBase,
  type: z.literal('form'),
  fields: z.array(VisualizationFormFieldSchema).min(1).max(VISUALIZATION_LIMITS.maxFormFields),
}).strict()

export const VisualizationViewSchema = z.discriminatedUnion('type', [
  chartView,
  tableView,
  categoryGridView,
  timelineView,
  swimlaneView,
  flowView,
  stateMachineView,
  playerView,
  formView,
])

export type VisualizationView = z.infer<typeof VisualizationViewSchema>

export const SubmitFollowUpActionSchema = z.object({
  id: shortIdentifier,
  type: z.literal('submit-follow-up'),
  label: safeString.max(MAX_LABEL_LENGTH),
  title: safeString.max(120).optional(),
  prompt: PromptTemplateAstSchema,
}).strict()

export type SubmitFollowUpAction = z.infer<typeof SubmitFollowUpActionSchema>

const visualizationNodeTypes = new Set([
  'not',
  'and',
  'or',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'add',
  'subtract',
  'multiply',
  'divide',
  'sum',
  'avg',
  'line',
  'bar',
  'area',
  'scatter',
  'stacked-bar',
  'table',
  'category-grid',
  'timeline',
  'swimlane',
  'flow',
  'state-machine',
  'player',
  'form',
])

function inspectDsl(value: unknown, depth = 0, metrics = { nodes: 0, maxDepth: 0 }): { nodes: number, maxDepth: number } {
  if (Array.isArray(value)) {
    for (const item of value) inspectDsl(item, depth, metrics)
    return metrics
  }
  if (value === null || typeof value !== 'object')
    return metrics

  const record = value as Record<string, unknown>
  const nextDepth = typeof record.type === 'string' && visualizationNodeTypes.has(record.type) ? depth + 1 : depth
  if (nextDepth > depth) {
    metrics.nodes += 1
    metrics.maxDepth = Math.max(metrics.maxDepth, nextDepth)
  }
  for (const child of Object.values(record)) inspectDsl(child, nextDepth, metrics)
  return metrics
}

function totalRows(data: VisualizationData): number {
  return Object.values(data).reduce((total, rows) => total + rows.length, 0)
}

export const VisualizationSpecV1Schema = z.object({
  version: z.literal(1),
  title: safeString.max(120),
  summary: safeString.max(500),
  data: VisualizationDataSchema,
  state: VisualizationStateMapSchema.optional(),
  layout: VisualizationLayoutSchema,
  views: z.array(VisualizationViewSchema).min(1).max(VISUALIZATION_LIMITS.maxViews),
  actions: z.array(SubmitFollowUpActionSchema).max(VISUALIZATION_LIMITS.maxActions).optional(),
}).strict().superRefine((spec, ctx) => {
  const serialized = JSON.stringify(spec)
  const size = new TextEncoder().encode(serialized).byteLength
  if (size > VISUALIZATION_LIMITS.maxBytes) {
    ctx.addIssue({ code: 'custom', path: ['data'], message: `可视化数据不能超过 ${VISUALIZATION_LIMITS.maxBytes} 字节` })
  }

  const metrics = inspectDsl(spec)
  if (metrics.nodes > VISUALIZATION_LIMITS.maxNodes) {
    ctx.addIssue({ code: 'custom', path: ['views'], message: `可视化节点数不能超过 ${VISUALIZATION_LIMITS.maxNodes}` })
  }
  if (metrics.maxDepth > VISUALIZATION_LIMITS.maxDepth) {
    ctx.addIssue({ code: 'custom', path: ['views'], message: `可视化 AST 深度不能超过 ${VISUALIZATION_LIMITS.maxDepth}` })
  }
  if (totalRows(spec.data) > VISUALIZATION_LIMITS.maxRows) {
    ctx.addIssue({ code: 'custom', path: ['data'], message: `数据行数不能超过 ${VISUALIZATION_LIMITS.maxRows}` })
  }

  const actionIds = new Set((spec.actions ?? []).map(action => action.id))
  if (actionIds.size !== (spec.actions ?? []).length) {
    ctx.addIssue({ code: 'custom', path: ['actions'], message: 'action id 必须唯一' })
  }
  const fieldIds = new Set<string>()
  for (const view of spec.views) {
    if (view.type === 'flow') {
      for (const node of view.nodes) {
        if (fieldIds.has(node.id))
          ctx.addIssue({ code: 'custom', path: ['views'], message: '视图节点 id 必须全局唯一' })
        fieldIds.add(node.id)
      }
    }
  }
})

export type VisualizationSpecV1 = z.infer<typeof VisualizationSpecV1Schema>

export const VisualizationThemeSchema = z.object({
  mode: z.enum(['light', 'dark']),
  tokens: z.object({
    background: safeString.max(80),
    foreground: safeString.max(80),
    card: safeString.max(80),
    border: safeString.max(80),
    mutedForeground: safeString.max(80),
    chart1: safeString.max(80),
    chart2: safeString.max(80),
    chart3: safeString.max(80),
    chart4: safeString.max(80),
    chart5: safeString.max(80),
  }).strict(),
}).strict()

export type VisualizationTheme = z.infer<typeof VisualizationThemeSchema>

const bridgeValue = z.union([safeString, finiteNumber, z.boolean(), z.null()])

export const HostToFrameMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    artifactId: shortIdentifier,
    spec: VisualizationSpecV1Schema,
    theme: VisualizationThemeSchema,
  }).strict(),
  z.object({
    type: z.literal('theme'),
    theme: VisualizationThemeSchema,
  }).strict(),
  z.object({
    type: z.literal('follow-up-result'),
    requestId: shortIdentifier,
    accepted: z.boolean(),
  }).strict(),
])

export type HostToFrameMessage = z.infer<typeof HostToFrameMessageSchema>
export const VisualizationHostToFrameMessageSchema = HostToFrameMessageSchema

export const FrameToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({
    type: z.literal('resize'),
    height: z.number().int().min(0).max(1_200),
  }).strict(),
  z.object({
    type: z.literal('follow-up-request'),
    requestId: shortIdentifier,
    artifactId: shortIdentifier,
    actionId: shortIdentifier,
    values: z.record(shortIdentifier, bridgeValue),
  }).strict(),
])

export type FrameToHostMessage = z.infer<typeof FrameToHostMessageSchema>
export const VisualizationFrameToHostMessageSchema = FrameToHostMessageSchema

export function canonicalizeVisualizationSpec(input: unknown): VisualizationSpecV1 {
  const parsed = VisualizationSpecV1Schema.parse(input)
  return sortObjectKeys(parsed) as VisualizationSpecV1
}

export function serializeVisualizationSpec(input: unknown): string {
  return JSON.stringify(canonicalizeVisualizationSpec(input))
}

export function getVisualizationSpecSize(input: unknown): number {
  return new TextEncoder().encode(serializeVisualizationSpec(input)).byteLength
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(sortObjectKeys)
  if (value === null || typeof value !== 'object')
    return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObjectKeys(child)]),
  )
}

export const VisualizationBlockSchema = z.object({
  type: z.literal('visualization'),
  source: z.object({ type: z.literal('file_id'), file_id: safeString.max(MAX_ID_LENGTH) }).strict(),
  format: z.literal(VISUALIZATION_FORMAT),
  title: safeString.max(120),
  summary: safeString.max(500),
  size: z.number().int().positive().max(VISUALIZATION_LIMITS.maxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 必须是小写十六进制摘要'),
  data: z.string().max(MAX_TRANSPORT_DATA_LENGTH).optional(),
}).strict()

export type VisualizationBlock = z.infer<typeof VisualizationBlockSchema>

/** 工具执行阶段携带原始 artifact 字节的内部 transport 合同，持久化前必须剥离 data。 */
export const VisualizationBlockTransportSchema = VisualizationBlockSchema.extend({
  data: z.string().max(MAX_TRANSPORT_DATA_LENGTH),
}).strict()

export type VisualizationBlockTransport = z.infer<typeof VisualizationBlockTransportSchema>

export const VisualizationOutputBlocksSchema = z.object({
  outputBlocks: z.array(VisualizationBlockTransportSchema).max(10),
}).strict()

export type VisualizationOutputBlocks = z.infer<typeof VisualizationOutputBlocksSchema>

/** 未知版本只作为可降级消息元数据保存，renderer 不会尝试解析或执行。 */
export const UnsupportedVisualizationBlockSchema = z.object({
  type: z.literal('visualization'),
  source: z.object({ type: z.literal('file_id'), file_id: safeString.max(MAX_ID_LENGTH) }).strict(),
  format: safeString.max(120).refine(format => format !== VISUALIZATION_FORMAT, '必须使用未知可视化版本'),
  title: safeString.max(120),
  summary: safeString.max(500),
  size: z.number().int().positive().max(VISUALIZATION_LIMITS.maxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.string().max(MAX_TRANSPORT_DATA_LENGTH).optional(),
}).strict()

export type UnsupportedVisualizationBlock = z.infer<typeof UnsupportedVisualizationBlockSchema>
