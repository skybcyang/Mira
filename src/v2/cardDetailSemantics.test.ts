import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('card detail semantics', () => {
  it('names card detail actions by their actual edit or read behavior', async () => {
    const card = await readFile(new URL('./ContentCard.tsx', import.meta.url), 'utf8')

    expect(card).toMatch(/import \{[^}]*\bMaximize2\b[^}]*\} from 'lucide-react'/)
    expect(card).toMatch(/import \{[^}]*\bPencil\b[^}]*\} from 'lucide-react'/)
    expect(card).toContain("data.card.contentKind === 'file-reference' ? '查看文件内容' : '编辑内容'")
    expect(card).toMatch(/data\.card\.contentKind === 'file-reference' \? <Maximize2[^:]+: <Pencil/)
    expect(card).toMatch(/<footer className="v2-card-footer" aria-label="卡片操作"[^>]*>/)
    expect(card).toContain('role="list"')
    expect(card).toContain('role="listitem"')
  })
})
