import {
  AddMcpConfigSchema,
  UpdateMcpConfigSchema,
} from '@ant-chat/shared'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import {
  mcpConfigsTable,
} from '../schema'

// ==================== MCP配置操作 ====================
export async function getMcpConfigs(): Promise<any[]> {
  return getDb().select().from(mcpConfigsTable).all()
}

export async function getMcpConfigByServerName(serverName: string): Promise<any> {
  return getDb().select().from(mcpConfigsTable).where(eq(mcpConfigsTable.serverName, serverName)).get()
}

export async function addMcpConfig(config: AddMcpConfigSchema): Promise<any> {
  const data = AddMcpConfigSchema.parse(config)

  return getDb().insert(mcpConfigsTable).values({ ...data, createdAt: Date.now(), updatedAt: Date.now() }).returning().get()
}

export async function updateMcpConfig(config: UpdateMcpConfigSchema): Promise<any> {
  const data = UpdateMcpConfigSchema.parse(config)
  return getDb().update(mcpConfigsTable).set(data).where(eq(mcpConfigsTable.serverName, config.serverName)).returning().get()
}

export async function deleteMcpConfig(serverName: string): Promise<boolean> {
  await getDb().delete(mcpConfigsTable).where(eq(mcpConfigsTable.serverName, serverName))

  return true
}
