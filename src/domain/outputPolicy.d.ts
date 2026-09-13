export type OutputFormat = 'auto' | 'paragraphs' | 'list' | 'table'
export interface OutputPolicy {
  id: string; version: string; title: string; text: string; digest: string; customized: boolean
  format: OutputFormat; maxCharacters?: number
}
export interface OutputPolicyInput { id: string; version: string; text?: string; format?: OutputFormat; maxCharacters?: number }
export interface OutputCheck { version: '1'; characters: number; format: OutputFormat; maxCharacters?: number; lengthPassed?: boolean; formatPassed?: boolean }
export const outputFormats: Readonly<Record<OutputFormat, string>>
export function listOutputPolicies(): OutputPolicy[]
export function resolveOutputPolicy(input: unknown): OutputPolicy | undefined
export function validateOutputPolicy(value: unknown, instruction?: string): void
export function outputPolicyPrompt(policy?: OutputPolicy): string[]
export function checkOutput(output: string, policy?: OutputPolicy): OutputCheck | undefined
export function validateOutputCheck(value: unknown, output: unknown, policy?: OutputPolicy): void
