import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command, FileText, Search, X } from 'lucide-react'
import type { ContentCard } from '../domain'
import { searchCards } from '../v2View'

export interface CommandItem {
  id: string
  label: string
  description: string
  action: () => void
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
}

export function filterCommandItems(commands: CommandItem[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return commands
  return commands.filter((command) =>
    `${command.label} ${command.description}`.toLocaleLowerCase().includes(needle),
  )
}

export default function CommandPalette({
  open,
  commands,
  onClose,
  cards = [],
  onLocateCard,
}: {
  open: boolean
  commands: CommandItem[]
  onClose: () => void
  cards?: ContentCard[]
  onLocateCard?: (cardId: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const cardResults = useMemo(() => searchCards(cards, query), [cards, query])
  const visible: CommandItem[] = [
    ...(onLocateCard ? cardResults.map((card) => ({
      id: `card-${card.cardId}`, label: card.title, description: card.preview,
      icon: <FileText size={17} />, action: () => onLocateCard(card.cardId),
    })) : []),
    ...filterCommandItems(commands, query),
  ]
  const cardCount = onLocateCard ? cardResults.length : 0
  const currentIndex = Math.min(activeIndex, Math.max(0, visible.length - 1))
  const activeOptionId = visible[currentIndex]
    ? `mira-command-option-${visible[currentIndex].id}`
    : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setQuery('')
      setActiveIndex(0)
      dialog.showModal()
      requestAnimationFrame(() => inputRef.current?.focus())
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => { setActiveIndex(0) }, [query])

  useEffect(() => {
    if (open && activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId, open])

  const invoke = (command: CommandItem | undefined) => {
    if (!command || command.disabled) return
    dialogRef.current?.close()
    onClose()
    command.action()
  }

  return <dialog
    ref={dialogRef}
    className="v2-command-palette"
    aria-label="命令菜单"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
  >
    <header className="v2-command-search">
      <Search size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="mira-command-results"
        aria-activedescendant={activeOptionId}
        aria-label="搜索卡片或命令"
        placeholder="搜索当前画板卡片或命令…"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex(visible.length ? (currentIndex + 1) % visible.length : 0)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex(visible.length ? (currentIndex - 1 + visible.length) % visible.length : 0)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            invoke(visible[currentIndex])
          }
        }}
      />
      <kbd>Esc</kbd>
      <button type="button" aria-label="关闭命令菜单" title="关闭" onClick={onClose}><X size={17} /></button>
    </header>
    <section id="mira-command-results" className="v2-command-results" role="listbox" aria-label="卡片与命令">
      <small role="presentation">{cardCount > 0 ? <><FileText size={12} aria-hidden="true" />当前画板 · {cardCount} 张卡片</> : <><Command size={12} aria-hidden="true" />快速操作</>}</small>
      {visible.length === 0
        ? <p role="status">没有匹配的卡片或命令</p>
        : visible.map((command, index) => <Fragment key={command.id}>
          {cardCount > 0 && index === cardCount && <small role="presentation"><Command size={12} aria-hidden="true" />快速操作</small>}
          <button
            id={`mira-command-option-${command.id}`}
            type="button"
            role="option"
            aria-selected={index === currentIndex}
            aria-disabled={command.disabled || undefined}
            disabled={command.disabled}
            data-active={index === currentIndex ? 'true' : undefined}
            data-kind={index < cardCount ? 'card' : 'command'}
            title={command.label}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => invoke(command)}
          >
            <span className="v2-command-result-icon">{command.icon}</span>
            <span><strong>{command.label}</strong><small>{command.description}</small></span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </button>
        </Fragment>)}
    </section>
  </dialog>
}
