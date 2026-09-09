import { Moon, Palette, Sun } from 'lucide-react'
import { THEME_DIRECTIONS, type Appearance } from './appearance'

export default function AppearanceSwitcher({
  appearance,
  onChange,
  embedded = false,
}: {
  appearance: Appearance
  onChange: (appearance: Appearance) => void
  embedded?: boolean
}) {
  const nextScheme = appearance.scheme === 'light' ? 'dark' : 'light'
  const controls = <>
    <Palette className="v2-appearance-icon" size={16} aria-hidden="true" />
    <div role="group" aria-label="设计方向">
      {THEME_DIRECTIONS.map((direction) => <button
        key={direction.id}
        type="button"
        title={direction.label}
        aria-label={direction.label}
        aria-pressed={appearance.direction === direction.id}
        className={appearance.direction === direction.id ? 'is-active' : ''}
        onClick={() => onChange({ ...appearance, direction: direction.id })}
      >
        <i className={`v2-theme-swatch is-${direction.id}`} aria-hidden="true" />
        <span>{direction.shortLabel}</span>
      </button>)}
    </div>
    <button
      className="v2-scheme-toggle"
      type="button"
      aria-label={`切换为${nextScheme === 'dark' ? '深色' : '浅色'}外观`}
      title={`切换为${nextScheme === 'dark' ? '深色' : '浅色'}外观`}
      onClick={() => onChange({ ...appearance, scheme: nextScheme })}
    >
      {appearance.scheme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  </>

  if (embedded) return <fieldset className="v2-appearance-switcher is-embedded">
    <legend>外观</legend>
    {controls}
  </fieldset>
  return <aside className="v2-appearance-switcher" aria-label="外观">{controls}</aside>
}
