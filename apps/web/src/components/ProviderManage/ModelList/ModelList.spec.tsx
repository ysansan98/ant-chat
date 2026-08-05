import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelList } from './ModelList'

const { deleteProviderModel, listProviderModels, setModelEnabledStatus } = vi.hoisted(() => ({
  deleteProviderModel: vi.fn(async () => null),
  listProviderModels: vi.fn(async () => [{
    id: 'shared-model',
    model: 'shared-model',
    providerId: 'provider-a',
    name: 'Shared Model',
    isEnabled: true,
    isBuiltin: false,
  }]),
  setModelEnabledStatus: vi.fn(async () => ({
    id: 'shared-model',
    model: 'shared-model',
    providerId: 'provider-a',
    name: 'Shared Model',
    isEnabled: false,
  })),
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    createProviderModel: vi.fn(),
    deleteProviderModel,
    listProviderModels,
    setModelEnabledStatus,
    syncModels: vi.fn(async () => []),
  },
}))

describe('modelList Provider 身份', () => {
  it('启停和删除模型时同时提交 Provider ID 与模型 ID', async () => {
    render(<ModelList providerId="provider-a" />)
    await screen.findByText('Shared Model')

    fireEvent.click(screen.getByRole('button', { name: '禁用 Shared Model' }))
    await waitFor(() => expect(setModelEnabledStatus).toHaveBeenCalledWith('provider-a', 'shared-model', false))

    fireEvent.click(screen.getByRole('button', { name: '删除 Shared Model' }))
    await waitFor(() => expect(deleteProviderModel).toHaveBeenCalledWith('provider-a', 'shared-model'))
  })
})
