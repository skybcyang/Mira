import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useV2Canvas } from '../v2Store'
import { autoDismissAfterMs, type Notice } from './noticePolicy'

function noticeIcon(notice: Notice): ReactNode {
  if (notice.kind === 'progress') return <LoaderCircle className="v2-notice-spinner" size={16} />
  if (notice.kind === 'success') return <CircleCheck size={16} />
  if (notice.kind === 'error') return <CircleAlert size={16} />
  if (notice.kind === 'attention') return <TriangleAlert size={16} />
  return <Info size={16} />
}

function NoticeItem({
  notice,
  onDismiss,
  onExpire,
}: {
  notice: Notice
  onDismiss: (noticeId: string) => void
  onExpire?: (noticeId: string, expectedNotice: Notice) => void
}) {
  useEffect(() => {
    const delay = autoDismissAfterMs(notice.kind)
    if (delay === null || !onExpire) return
    const timer = window.setTimeout(() => onExpire(notice.id, notice), delay)
    return () => window.clearTimeout(timer)
  }, [notice, onExpire])

  return <article
    className="v2-notice"
    data-notice-kind={notice.kind}
    {...(notice.kind === 'error' ? { role: 'alert' as const, 'aria-atomic': true } : {})}
  >
    <span className="v2-notice-icon" aria-hidden="true">{noticeIcon(notice)}</span>
    <span>{notice.message}</span>
    <button
      type="button"
      aria-label={`关闭通知：${notice.message}`}
      title="关闭通知"
      onClick={() => onDismiss(notice.id)}
    ><X size={15} /></button>
  </article>
}

export function NoticeRegionView({
  notices,
  onDismiss,
  onExpire,
}: {
  notices: Notice[]
  onDismiss: (noticeId: string) => void
  onExpire?: (noticeId: string, expectedNotice: Notice) => void
}) {
  if (notices.length === 0) return null
  const blocking = notices.filter((notice) => notice.kind === 'error')
  const polite = notices.filter((notice) => notice.kind !== 'error')
  return <section className="v2-notice-region" aria-label="通知">
    <div className="v2-notice-alerts">
      {blocking.map((notice) => <NoticeItem
        key={notice.id}
        notice={notice}
        onDismiss={onDismiss}
        onExpire={onExpire}
      />)}
    </div>
    <div className="v2-notice-polite" aria-live="polite" aria-relevant="additions text">
      {polite.map((notice) => <NoticeItem
        key={notice.id}
        notice={notice}
        onDismiss={onDismiss}
        onExpire={onExpire}
      />)}
    </div>
  </section>
}

export default function NoticeRegion() {
  const [panel, setPanel] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1099px)')
    const sync = () => setPanel(media.matches
      ? Array.from(document.querySelectorAll<HTMLElement>('.v2-detail-drawer, .v2-workflow-library, .v2-model-settings, .v2-board-history'))
        .find(element => element.getClientRects().length > 0) || null
      : null)
    const observer = new MutationObserver(sync)
    observer.observe(document.querySelector('.v2-app') || document.body, { childList: true, subtree: true })
    media.addEventListener('change', sync)
    sync()
    return () => { observer.disconnect(); media.removeEventListener('change', sync) }
  }, [])
  const notices = useV2Canvas((state) => state.notices)
  const dismissNotice = useV2Canvas((state) => state.dismissNotice)
  const expireNotice = useV2Canvas((state) => state.expireNotice)
  const content = <NoticeRegionView
    notices={notices}
    onDismiss={dismissNotice}
    onExpire={expireNotice}
  />
  return panel ? createPortal(content, panel) : content
}
