import type { AppRpcClient, AppRpcInput, AppRpcMethod, AppRpcOutput, AppRuntimeCapabilities } from '@ant-chat/shared'
import { ipc, isElectronRuntime, unwrapIpcResponse } from '@/utils/ipc-bus'

let cachedClient: AppRpcClient | null = null

export function getAppRuntimeCapabilities(): AppRuntimeCapabilities {
  const isElectron = isElectronRuntime()
  return {
    nativeWindow: isElectron,
    autoUpdate: isElectron,
    nativeFilePicker: isElectron,
  }
}

export function getAppRpcClient(): AppRpcClient {
  if (cachedClient) {
    return cachedClient
  }

  cachedClient = isElectronRuntime()
    ? createElectronRpcClient()
    : createLocalWebRpcClient()
  return cachedClient
}

export function clearAppRpcClientCache(): void {
  cachedClient = null
}

function createElectronRpcClient(): AppRpcClient {
  return {
    async call(method, input) {
      return unwrapIpcResponse(await ipc.runtime.call(method, input))
    },
  }
}

function createLocalWebRpcClient(): AppRpcClient {
  return {
    call: localRpc,
  }
}

export async function localRpc<TMethod extends AppRpcMethod>(
  method: TMethod,
  input: AppRpcInput<TMethod>,
): Promise<AppRpcOutput<TMethod>> {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, input }),
  })
  const payload = await response.json() as { success: boolean, data?: AppRpcOutput<TMethod>, msg?: string }

  if (!payload.success) {
    throw new Error(payload.msg || `Local API failed: ${method}`)
  }

  return payload.data as AppRpcOutput<TMethod>
}
