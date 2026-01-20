import type { ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { AddServiceProviderSchema } from '@ant-chat/shared'
import { eq, getTableColumns } from 'drizzle-orm'
import { db } from '../db'
import { serviceProviderModelsTable, serviceProviderTable } from '../schema'

export function getAllProviderServices(): ServiceProviderSchema[] {
  return db.select().from(serviceProviderTable).all()
}

export function updateProviderService(config: UpdateServiceProviderSchema) {
  return db.update(serviceProviderTable)
    .set({ ...config, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(serviceProviderTable.id, config.id))
    .returning()
    .get({ id: config.id })
}

export function addProviderService(config: AddServiceProviderSchema) {
  const data = AddServiceProviderSchema.parse(config)
  return db.insert(serviceProviderTable).values({
    ...data,
    isOfficial: false,
  }).returning().get()
}

export async function deleteProviderService(id: string) {
  return db.transaction((tx) => {
    // 先删除关联的models
    tx.delete(serviceProviderModelsTable)
      .where(eq(serviceProviderModelsTable.serviceProviderId, id))
      .run()

    // 再删除provider
    tx.delete(serviceProviderTable)
      .where(eq(serviceProviderTable.id, id))
      .run()
  })
}

export function getProviderServiceById(id: string) {
  return db.select().from(serviceProviderTable).where(eq(serviceProviderTable.id, id)).get()
}

export function getServiceProviderByModelId(id: string) {
  return db.select({ ...getTableColumns(serviceProviderTable) })
    .from(serviceProviderTable)
    .leftJoin(serviceProviderModelsTable, eq(serviceProviderTable.id, serviceProviderModelsTable.serviceProviderId))
    .where(eq(serviceProviderModelsTable.id, id))
    .get()
}
