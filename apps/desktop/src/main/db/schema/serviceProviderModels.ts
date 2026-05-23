import type { ModelFeaturesSchema } from '@ant-chat/shared'
import { relations, sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'
import { serviceProviderTable } from './serviceProviders'

export const serviceProviderModelsTable = sqliteTable(
  'service_provider_models',
  {
    id: text('id').primaryKey().$defaultFn(() => `model-${nanoid()}`),
    name: text('name').notNull(),
    model: text('model').notNull(),
    isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    maxTokens: integer('max_tokens').notNull().default(4096),
    contextLength: integer('context_length').notNull().default(2048576),
    temperature: real('temperature').notNull().default(0.7),
    modelFeatures: text('model_features', { mode: 'json' }).$type<ModelFeaturesSchema | null>(),
    serviceProviderId: text('service_provider_id').notNull().references(() => serviceProviderTable.id),
    createdAt: integer('created_at').notNull().default(sql`(strftime('%s','now'))`),
  },
  t => [unique().on(t.model, t.serviceProviderId)],
)

/**
 * 定义关联关系
 */
export const providerServiceModelsRelations = relations(serviceProviderModelsTable, ({ one }) => ({
  providerService: one(serviceProviderTable, { fields: [serviceProviderModelsTable.serviceProviderId], references: [serviceProviderTable.id] }),
}))
