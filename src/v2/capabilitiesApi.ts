import { request } from '../v2Api'
import type { ToolDefinition, ToolFile } from '../domain/toolPolicy.js'
export interface McpConnection { id: string; title: string; transport: 'http' | 'stdio'; url?: string; command?: string; args?: string[]; cwd?: string; envNames?: string[]; requiresCredential?: boolean; hasCredential?: boolean }
export interface PythonScript { id: string; title: string; code: string; digest: string; imageId: string; inputSchema: Record<string, unknown>; version: number }
export interface CapabilitySettings { schemaVersion: 1; revision: number; connections: McpConnection[]; tools: ToolDefinition[]; scripts: PythonScript[]; enabled: string[]; pythonImageId?: string }
export interface CapabilityCatalog { settings: CapabilitySettings; builtins: ToolDefinition[]; runtime: { mcp: boolean; python: boolean } }
export interface PythonStatus { available: boolean; reason?: string; imageId?: string; runtime?: string }
export interface PythonResult { text: string; files?: ToolFile[] }
export interface ConnectionInput { baseRevision: number; connection: Omit<McpConnection, 'id' | 'hasCredential'> & { id?: string }; credential?: { token?: string; env?: Record<string, string> } }
export type CapabilityUpdate = { baseRevision: number } & ({ tool: { id: string; enabled: boolean; readOnly?: boolean } } | { removeConnection: string } | { script: Pick<PythonScript, 'title' | 'code' | 'inputSchema' | 'imageId'> & { id?: string } })
export const capabilitiesApi = {
  get: () => request<CapabilityCatalog>('GET', '/capabilities'),
  update: (input: CapabilityUpdate) => request<{ settings: CapabilitySettings }>('PATCH', '/capabilities', input),
  connect: (input: ConnectionInput, signal?: AbortSignal) => request<{ settings: CapabilitySettings }>('POST', '/capabilities/connections', input, signal),
  pythonStatus: (image?: string) => image === undefined
    ? request<PythonStatus>('GET', '/capabilities/python')
    : request<PythonStatus>('POST', '/capabilities/python/status', { image }),
  preparePython: (input: { baseRevision: number; image: string; dependencies: string[] }, signal?: AbortSignal) => request<CapabilityCatalog & { python: PythonStatus }>('POST', '/capabilities/python/prepare', input, signal),
  testPython: (input: { code: string; imageId: string; arguments: Record<string, unknown> }, signal?: AbortSignal) => request<PythonResult>('POST', '/capabilities/python/test', input, signal),
}
