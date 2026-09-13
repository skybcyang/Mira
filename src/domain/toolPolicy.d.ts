export type ToolPhase = 'before' | 'model' | 'after'
export interface ToolDefinition { id: string; title: string; description: string; source: 'builtin' | 'mcp' | 'python'; version: string; name: string; inputSchema: Record<string, unknown>; phases: ToolPhase[]; effect: 'read' | 'review' | 'check'; bindingId?: string; bindingVersion?: string; requiresBinding?: true }
export interface ToolConfiguration { id: string; tool: ToolDefinition; phase: ToolPhase; arguments: Record<string, unknown>; urls?: string[] }
export interface ToolPolicy { tools: ToolConfiguration[]; allowTemporaryPython: boolean }
export interface ToolFile { name: string; mimeType: string; data: string }
export interface ToolExecution { id: string; configId: string; title: string; version: string; phase: ToolPhase; status: 'started' | 'succeeded' | 'failed'; arguments: Record<string, unknown>; startedAt: string; finishedAt?: string; text?: string; error?: string; files?: ToolFile[]; filesOmitted?: boolean }
export interface ToolReview { requestId: string; digest: string; configId: string; title: string; version: string; arguments: Record<string, unknown>; code?: string; environment?: string; expiresAt: string }
export const toolPhases: Record<ToolPhase, string>
export function toolError(code: string, message: string): Error & { code: string }
export function jsonBytes(value: unknown): number
export function canonicalToolJson(value: unknown): string
export function validateToolJson(value: unknown): void
export function validateToolArgumentData(value: unknown): void
export function validateToolSchema(value: unknown): void
export function validateToolFiles(value: unknown): void
export function validateMethodToolPolicy(value: unknown): void
export function isObject(value: unknown): boolean
export function toolDefinition(input: Omit<ToolDefinition, 'version'>): ToolDefinition
export function listBuiltinTools(): ToolDefinition[]
export function validateTool(value: unknown): void
export function validateToolPolicy(value: unknown): void
export function validateToolEvidence(value: unknown): void
export function portableToolPolicy(policy?: ToolPolicy): ToolPolicy | undefined
export function methodToolPolicy(policy?: ToolPolicy): ToolPolicy | undefined
export function portableToolEvidence<T>(run: T): T
