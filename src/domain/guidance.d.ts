export interface GuidanceSnapshot {
  id: string; version: string; title: string; text: string; digest: string; customized: boolean
  origin?: 'custom' | 'imported'
}
export interface GuidanceInput { id: string; version: string; text?: string }
export function listGuidance(): GuidanceSnapshot[]
export function validateGuidance(value: unknown): void
export function resolveGuidance(value: unknown, projectEntries?: GuidanceSnapshot[]): GuidanceSnapshot | undefined
export function assertGuidanceCriteria(guidance: GuidanceSnapshot | undefined, acceptance: string): void
