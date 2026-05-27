import type { ListWorkspacesData, WorkspaceFileSearchResult } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

async function listWorkspaces(): Promise<ListWorkspacesData> {
  return (await getAppTransport()).workspace.listWorkspaces()
}

async function addWorkspace(path: string): Promise<ListWorkspacesData> {
  return (await getAppTransport()).workspace.addWorkspace(path)
}

async function removeWorkspace(path: string): Promise<ListWorkspacesData> {
  return (await getAppTransport()).workspace.removeWorkspace(path)
}

async function openWorkspace(path: string): Promise<ListWorkspacesData> {
  return (await getAppTransport()).workspace.openWorkspace(path)
}

async function chooseWorkspace(): Promise<ListWorkspacesData | null> {
  return (await getAppTransport()).workspace.chooseWorkspace()
}

async function searchWorkspaceFiles(query: string, limit = 50): Promise<WorkspaceFileSearchResult[]> {
  return (await getAppTransport()).workspace.searchWorkspaceFiles(query, limit)
}

export default {
  listWorkspaces,
  addWorkspace,
  removeWorkspace,
  openWorkspace,
  chooseWorkspace,
  searchWorkspaceFiles,
}
