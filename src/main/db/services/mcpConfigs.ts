import {
  AddMcpConfigSchema,
  UpdateMcpConfigSchema,
} from '@ant-chat/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import {
  mcpConfigsTable,
} from '../schema'

// ==================== MCP配置操作 ====================
export async function getMcpConfigs(): Promise<any[]> {
  return db.select().from(mcpConfigsTable).all()
}

export async function getMcpConfigByServerName(serverName: string): Promise<any> {
  return db.select()
    .from(mcpConfigsTable)
    .where(eq(mcpConfigsTable.serverName, serverName))
    .get()
}

export async function addMcpConfig(config: AddMcpConfigSchema): Promise<any> {
  const data = AddMcpConfigSchema.parse(config)

  return db.insert(mcpConfigsTable)
    .values({ ...data, createdAt: Date.now(), updatedAt: Date.now() })
    .returning()
    .get()
}

export async function updateMcpConfig(config: UpdateMcpConfigSchema): Promise<any> {
  const data = UpdateMcpConfigSchema.parse(config)
  return db.update(mcpConfigsTable)
    .set(data)
    .where(eq(mcpConfigsTable.serverName, config.serverName))
    .returning()
    .get()
}

export async function deleteMcpConfig(serverName: string): Promise<boolean> {
  await db.delete(mcpConfigsTable)
    .where(eq(mcpConfigsTable.serverName, serverName))

  return true
}
