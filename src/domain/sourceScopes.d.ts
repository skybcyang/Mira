export interface TextSpan { start: number; end: number }
export interface RangeScope { mode: 'ranges'; versionId: string; contentDigest: string; spans: TextSpan[] }
export type SourceScope = { cardId: string } & (RangeScope | { mode: 'required' })
export interface ScopedText { resolvedContent: string; lines: Array<{ startLine: number; endLine: number }> }
export function contentDigest(text: string): Promise<string>
export function validateSpans(spans: unknown): TextSpan[]
export function validateSourceScopes(scopes: unknown, sourceCardIds: string[]): SourceScope[]
export function sameScope(left?: SourceScope | RangeScope, right?: SourceScope | RangeScope): boolean
export function assembleScopedText(text: string, spans: TextSpan[]): ScopedText
export function resolveSourceScope(text: string, scope: SourceScope | RangeScope, versionId: string, path?: string): Promise<ScopedText>
export function textChapters(text: string): Array<TextSpan & { title: string; level: number }>
export function nativeSelectionSpan(text: string, start: number, end: number): TextSpan
