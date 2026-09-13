export interface ExtractionItem { itemId: string; title: string; markdown: string }
export interface ExtractionSource { boardId: string; cardId: string; versionId: string; itemId: string }
export function validExtractionSources(refs: unknown): boolean
export interface ExtractionRef { boardId: string; cardId: string; versionId: string; itemId: string; batchId: string }
export const EXTRACTION_HEADER: string
export function parseExtractionList(markdown: string): ExtractionItem[] | null
export function validateExtractionItems(items: unknown, source: ExtractionItem[]): ExtractionItem[]
export function extractionInstruction(requirement: string): string
export function extractionRequirement(instruction: string): string | null
export function validExtractionRef(ref: unknown): boolean
export function assertExtractionSources(instruction: string, sources: { contentKind: string; resolvedContent: string; path?: string }[]): void
