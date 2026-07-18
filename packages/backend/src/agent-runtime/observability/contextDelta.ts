import { createHash } from 'node:crypto'
import deepEqual from 'fast-deep-equal'

export interface ContextBaseline {
  kind: 'baseline'
  value: unknown
  hash: string
}

export interface ContextDelta {
  kind: 'delta'
  operations: ContextDeltaOperation[]
  baseHash: string
  hash: string
}

export type ContextSnapshot = ContextBaseline | ContextDelta

export type ContextDeltaOperation
  = | { op: 'set', path: string[], value: unknown }
    | { op: 'remove', path: string[] }

export function createContextSnapshot(previous: unknown | undefined, current: unknown): ContextSnapshot {
  const cloned = cloneJson(current)
  if (previous === undefined) {
    return { kind: 'baseline', value: cloned, hash: hashContext(cloned) }
  }
  return {
    kind: 'delta',
    operations: diffValue(previous, cloned),
    baseHash: hashContext(previous),
    hash: hashContext(cloned),
  }
}

export function applyContextSnapshot(previous: unknown | undefined, snapshot: ContextSnapshot): unknown {
  if (snapshot.kind === 'baseline') {
    if (hashContext(snapshot.value) !== snapshot.hash)
      throw new Error('corrupt-delta')
    return cloneJson(snapshot.value)
  }
  if (previous === undefined || hashContext(previous) !== snapshot.baseHash)
    throw new Error('corrupt-delta')
  let next: unknown = cloneJson(previous)
  for (const operation of snapshot.operations)
    next = applyOperation(next, operation)
  if (hashContext(next) !== snapshot.hash)
    throw new Error('corrupt-delta')
  return next
}

export function hashContext(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function diffValue(previous: unknown, current: unknown, path: string[] = []): ContextDeltaOperation[] {
  if (deepEqual(previous, current))
    return []
  if (!isPlainObject(previous) || !isPlainObject(current))
    return [{ op: 'set', path, value: cloneJson(current) }]

  const operations: ContextDeltaOperation[] = []
  for (const key of Object.keys(previous)) {
    if (!(key in current))
      operations.push({ op: 'remove', path: [...path, key] })
  }
  for (const [key, value] of Object.entries(current)) {
    if (!(key in previous))
      operations.push({ op: 'set', path: [...path, key], value: cloneJson(value) })
    else
      operations.push(...diffValue(previous[key], value, [...path, key]))
  }
  return operations
}

function applyOperation(root: unknown, operation: ContextDeltaOperation): unknown {
  if (operation.path.length === 0)
    return operation.op === 'set' ? cloneJson(operation.value) : undefined
  if (!isPlainObject(root))
    throw new Error('corrupt-delta')
  const next = cloneJson(root) as Record<string, unknown>
  let target = next
  for (const segment of operation.path.slice(0, -1)) {
    const child = target[segment]
    if (!isPlainObject(child))
      throw new Error('corrupt-delta')
    target[segment] = cloneJson(child)
    target = target[segment] as Record<string, unknown>
  }
  const key = operation.path[operation.path.length - 1]
  if (operation.op === 'remove')
    delete target[key]
  else
    target[key] = cloneJson(operation.value)
  return next
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  if (value === undefined)
    return value
  return JSON.parse(JSON.stringify(value)) as T
}
