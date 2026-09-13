import type { TextSpan } from './sourceScopes.js'
export interface MaterialOrigin {
  assetPath?: string
  kind: 'web' | 'pdf'; title: string; url?: string; requestedUrl?: string; path?: string; capturedAt: string
  sourceDigest: string; textDigest: string; reader: { id: string; version: string }; locators: Array<TextSpan & { page?: number }>
}
export interface MaterialPreview {
  previewId: string; expiresAt: string; origin: Omit<MaterialOrigin, 'locators'>; text: string
  pages?: Array<TextSpan & { page: number; status: 'text' | 'empty' | 'unreadable' }>
  warnings: Array<{ code: string; message: string; page?: number }>
}
export function validateMaterialOrigin(origin: unknown): MaterialOrigin
export function selectMaterial(preview: MaterialPreview, spans: TextSpan[]): { markdown: string; materialOrigin: MaterialOrigin }
export function materialTextDigest(text: string): string
