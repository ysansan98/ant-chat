import type { ListWorkspacesData } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

async function listWorkspaces(): Promise<ListWorkspacesData> {
  return unwrapIpcResponse(await ipc.workspace.listWorkspaces())
}

async function addWorkspace(path: string): Promise<ListWorkspacesData> {
  return unwrapIpcResponse(await ipc.workspace.addWorkspace(path))
}

async function removeWorkspace(path: string): Promise<ListWorkspacesData> {
  return unwrapIpcResponse(await ipc.workspace.removeWorkspace(path))
}

async function openWorkspace(path: string): Promise<ListWorkspacesData> {
  return unwrapIpcResponse(await ipc.workspace.openWorkspace(path))
}

async function chooseWorkspace(): Promise<ListWorkspacesData | null> {
  return unwrapIpcResponse(await ipc.workspace.chooseWorkspace())
}

export default {
  listWorkspaces,
  addWorkspace,
  removeWorkspace,
  openWorkspace,
  chooseWorkspace,
}
