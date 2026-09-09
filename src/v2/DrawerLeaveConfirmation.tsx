import { useEffect, useRef, useState } from 'react'

export default function DrawerLeaveConfirmation({ onContinue, onDiscard, onSave, switching = false, plan = false }: {
  onContinue: () => void
  onDiscard: () => void
  onSave?: () => Promise<boolean>
  switching?: boolean
  plan?: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={dialogRef} className="v2-drawer-leave-confirm" role="alertdialog" aria-modal="true"
    aria-labelledby="v2-discard-drawer-title" aria-describedby="v2-discard-drawer-description"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!lock.current) onContinue() }}
    onClick={event => { if (event.target === event.currentTarget && !lock.current) onContinue() }}>
    <h2 id="v2-discard-drawer-title">{switching && onSave ? '切换前保存修改？' : '还有未保存的修改'}</h2>
    <p id="v2-discard-drawer-description">{plan ? '计划尚未添加到画板。可以继续填写，或放弃这份草稿。' : <>当前修改尚未保存。{onSave ? switching ? '保存成功后再切换卡片。' : '可以先保存，或放弃这些修改。' : '可以继续编辑并保存，或放弃这些修改。'}</>}</p>
    {failed && <p role="alert">未能保存全部修改，已保留当前卡片和草稿。请继续编辑并处理保存提示。</p>}
    <div>
      <button autoFocus type="button" disabled={saving} onClick={onContinue}>继续编辑</button>
      <button className="v2-danger-button" type="button" disabled={saving} onClick={onDiscard}>{switching ? '放弃并切换' : '放弃修改'}</button>
      {onSave && <button className="v2-primary-button" type="button" disabled={saving} onClick={() => {
        if (lock.current) return
        lock.current = true; setSaving(true); setFailed(false)
        void onSave().then(saved => { if (!saved) setFailed(true) }, () => setFailed(true))
          .finally(() => { lock.current = false; setSaving(false) })
      }}>{saving ? '保存中…' : switching ? '保存并切换' : '保存并继续'}</button>}
    </div>
  </dialog>
}
