import type { AllAvailableModelsSchema, ServiceProviderModelsSchema } from '@ant-chat/shared'
import { AddServiceProviderModelSchema } from '@ant-chat/shared'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { serviceProviderModelsTable, serviceProviderTable } from '../schema'

export async function getAllAvailableModels(): Promise<AllAvailableModelsSchema[]> {
  const data = await db.query.serviceProviderTable.findMany({
    columns: {
      id: true,
      name: true,
      baseUrl: true,
      apiKey: true,
      apiMode: true,
      isOfficial: true,
    },
    with: {
      models: {
        columns: {
          id: true,
          name: true,
          model: true,
          modelFeatures: true,
          maxTokens: true,
          temperature: true,
          contextLength: true,
          serviceProviderId: true,
        },
        where: eq(serviceProviderModelsTable.isEnabled, true),
      },
    },
    where: eq(serviceProviderTable.isEnabled, true),
  })

  return data as AllAvailableModelsSchema[]
}

export async function getModelsByServiceProviderId(providerServiceId: string): Promise<ServiceProviderModelsSchema[]> {
  const models = await db.select()
    .from(serviceProviderModelsTable)
    .where(eq(serviceProviderModelsTable.serviceProviderId, providerServiceId))
    .orderBy(desc(serviceProviderModelsTable.createdAt))

  return models
}

export async function setModelEnabledStatus(id: string, status: boolean) {
  return db.update(serviceProviderModelsTable)
    .set({ isEnabled: status })
    .where(eq(serviceProviderModelsTable.id, id))
    .returning()
    .get()
}

export async function addServiceProviderModel(config: AddServiceProviderModelSchema) {
  const data = AddServiceProviderModelSchema.parse(config)

  const count = await db.$count(serviceProviderModelsTable, and(
    eq(serviceProviderModelsTable.serviceProviderId, data.serviceProviderId),
    eq(serviceProviderModelsTable.model, data.model),
  ))

  if (count >= 1) {
    throw new Error(`${data.model} 已存在，不可重复添加`)
  }

  return db.insert(serviceProviderModelsTable)
    .values({ ...data, isEnabled: true })
    .returning()
    .get()
}

export async function deleteServiceProviderModel(id: string) {
  return db.delete(serviceProviderModelsTable).where(eq(serviceProviderModelsTable.id, id))
}

export async function getModelById(id: string) {
  return db.select().from(serviceProviderModelsTable).where(eq(serviceProviderModelsTable.id, id)).get()
}
