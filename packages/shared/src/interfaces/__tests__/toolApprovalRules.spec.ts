import { describe, expect, it } from 'vitest'
import { PERMISSIONS_SCHEMA_VERSION, PermissionsFileSchema, ToolApprovalRuleInputSchema } from '../../schemas/toolApprovalRules'

const baseRule = {
  id: 'rule-1',
  createdAt: 1,
  updatedAt: 1,
  kind: 'filesystem' as const,
  canonicalPath: '/workspace/file.txt',
}

describe('权限文件 schema', () => {
  it.each([
    {
      name: '目录写入',
      rule: { ...baseRule, access: 'write', targetType: 'directory', recursive: true },
    },
    {
      name: '非递归目录读取',
      rule: { ...baseRule, access: 'read', targetType: 'directory', recursive: false },
    },
    {
      name: '递归文件读取',
      rule: { ...baseRule, access: 'read', targetType: 'file', recursive: true },
    },
    {
      name: '递归文件写入',
      rule: { ...baseRule, access: 'write', targetType: 'file', recursive: true },
    },
  ])('整份文件包含$name规则时拒绝加载', ({ rule }) => {
    const result = PermissionsFileSchema.safeParse({
      schemaVersion: PERMISSIONS_SCHEMA_VERSION,
      data: { global: [rule], workspaces: {} },
    })

    expect(result.success).toBe(false)
  })

  it.each([
    { access: 'read', targetType: 'file', recursive: false },
    { access: 'write', targetType: 'file', recursive: false },
    { access: 'read', targetType: 'directory', recursive: true },
  ] as const)('接受受支持的文件系统权限：$access $targetType', (rule) => {
    expect(PermissionsFileSchema.safeParse({
      schemaVersion: PERMISSIONS_SCHEMA_VERSION,
      data: { global: [{ ...baseRule, ...rule }], workspaces: {} },
    }).success).toBe(true)
  })
})

describe('权限管理输入 schema', () => {
  it('命令规则保存解释器和用户写出的命令身份', () => {
    const result = ToolApprovalRuleInputSchema.safeParse({
      kind: 'command',
      interpreter: 'bash',
      executable: 'node',
      argvPrefix: ['run.js'],
      allowRemainingArgs: false,
      resourceScope: 'workspace',
    })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ kind: 'command', interpreter: 'bash' })
    expect(result.data).not.toHaveProperty('executablePath')
  })

  it('当前权限文件不再接受可执行文件解析路径', () => {
    const result = PermissionsFileSchema.safeParse({
      schemaVersion: PERMISSIONS_SCHEMA_VERSION,
      data: {
        global: [{
          id: 'command-1',
          createdAt: 1,
          updatedAt: 1,
          kind: 'command',
          interpreter: 'bash',
          executable: 'node',
          executablePath: '/runtime/nub',
          argvPrefix: ['run.js'],
          allowRemainingArgs: false,
          resourceScope: 'workspace',
        }],
        workspaces: {},
      },
    })

    expect(result.success).toBe(false)
  })

  it('拒绝历史 Bash 规则类型', () => {
    expect(ToolApprovalRuleInputSchema.safeParse({
      kind: 'bash-command',
      executable: 'node',
      argvPrefix: [],
      allowRemainingArgs: true,
      resourceScope: 'workspace',
    }).success).toBe(false)
  })

  it.each(['bash', 'powershell7', 'windows-powershell', 'cmd'] as const)(
    '接受 $interpreter 解释器的命令规则',
    (interpreter) => {
      expect(ToolApprovalRuleInputSchema.safeParse({
        kind: 'command',
        interpreter,
        executable: 'echo',
        argvPrefix: [],
        allowRemainingArgs: true,
        resourceScope: 'workspace',
      }).success).toBe(true)
    },
  )

  it('不接受前端指定持久化身份和时间戳', () => {
    const result = ToolApprovalRuleInputSchema.safeParse({
      ...baseRule,
      access: 'read',
      targetType: 'file',
      recursive: false,
    })

    expect(result.success).toBe(false)
  })
})
