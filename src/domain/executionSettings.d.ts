import type { GuidanceSnapshot } from './guidance.js'
import type { OutputPolicy, OutputPolicyInput } from './outputPolicy.js'
export interface ExecutionSettings { schemaVersion: 1; revision: number; defaultOutputPolicy: OutputPolicy | null; guidance: GuidanceSnapshot[]; disabledGuidanceIds: string[] }
export interface GuidanceChange { id?: string; title: string; text: string; origin?: 'custom' | 'imported' }
export type ExecutionSettingsInput = { baseRevision: number } & ({ defaultOutputPolicy: OutputPolicyInput | null } | { guidance: GuidanceChange } | { disabledGuidance: { id: string; disabled: boolean } })
export function emptyExecutionSettings(): ExecutionSettings
export function importGuidanceText(filename: string, text: string): GuidanceChange
export function validateExecutionSettings(value: unknown): void
export function projectGuidance(settings?: ExecutionSettings, latestOnly?: boolean): GuidanceSnapshot[]
export function guidanceCatalog(settings?: ExecutionSettings): GuidanceSnapshot[]
export function resolveStepOutput(input: unknown, settings?: ExecutionSettings): OutputPolicy | undefined
export function updateExecutionSettings(current: ExecutionSettings, input: unknown, newId: (prefix: string) => string): ExecutionSettings
