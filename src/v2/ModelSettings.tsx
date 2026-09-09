import { Check, Eye, EyeOff, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type ModelConnectionResult,
  type ModelSettings,
  type ModelSettingsInput,
  v2Api,
} from '../v2Api'

const KIMI_BASE_URL = 'https://api.kimi.com/coding/v1'
const KIMI_MODEL = 'k3'

type LoadState = 'loading' | 'ready' | 'error'
type ActionState = 'idle' | 'testing' | 'tested' | 'saving' | 'saved' | 'error'

function isKimi(settings: Pick<ModelSettings, 'baseUrl' | 'model'> | null) {
  return settings?.baseUrl === KIMI_BASE_URL && settings.model === KIMI_MODEL
}

function messageFor(error: unknown) {
  const candidate = error as { status?: number; message?: string }
  if (candidate?.status === 404) return '当前部署不支持网页模型设置'
  return candidate?.message || '模型设置暂时无法读取'
}

export function ModelSettingsView({
  settings,
  state,
  errorMessage,
  onClose,
  onReload,
  onSave,
  onTest,
}: {
  settings: ModelSettings | null
  state: LoadState
  errorMessage?: string
  onClose: () => void
  onReload?: () => void
  onSave: (input: ModelSettingsInput) => Promise<ModelSettings | void>
  onTest: (input: ModelSettingsInput) => Promise<ModelConnectionResult>
}) {
  const [preset, setPreset] = useState<'kimi-k3' | 'custom'>(
    isKimi(settings) ? 'kimi-k3' : 'custom',
  )
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl || '')
  const [model, setModel] = useState(settings?.model || '')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [actionState, setActionState] = useState<ActionState>('idle')
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    if (!settings) return
    setPreset(isKimi(settings) ? 'kimi-k3' : 'custom')
    setBaseUrl(settings.baseUrl)
    setModel(settings.model)
    setApiKey('')
    setClearApiKey(false)
  }, [settings])

  const input = useMemo<ModelSettingsInput>(() => ({
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    ...(clearApiKey ? { clearApiKey: true } : {}),
  }), [apiKey, baseUrl, clearApiKey, model])
  const busy = actionState === 'testing' || actionState === 'saving'
  const valid = Boolean(input.baseUrl && input.model)

  const testConnection = async () => {
    setActionState('testing')
    setActionMessage('')
    try {
      const result = await onTest(input)
      setActionState('tested')
      setActionMessage(`连接正常 · ${result.latencyMs} ms`)
    } catch (error) {
      setActionState('error')
      setActionMessage(messageFor(error))
    }
  }

  const save = async () => {
    setActionState('saving')
    setActionMessage('')
    try {
      await onSave(input)
      setApiKey('')
      setClearApiKey(false)
      setActionState('saved')
      setActionMessage('设置已保存')
    } catch (error) {
      setActionState('error')
      setActionMessage(messageFor(error))
    }
  }

  return <aside className="v2-model-settings" aria-label="模型设置">
    <header className="v2-model-settings-head">
      <div><span>运行设置</span><h2>模型连接</h2></div>
      <button autoFocus className="v2-icon-button" type="button" aria-label="关闭模型设置" title="关闭模型设置" onClick={onClose}><X size={18} /></button>
    </header>
    {state === 'loading' && <div className="v2-model-settings-state">正在读取模型设置…</div>}
    {state === 'error' && <div className="v2-model-settings-state" role="alert"><span>{errorMessage || '模型设置暂时无法读取'}</span><button className="v2-secondary-button" type="button" onClick={onReload}><RefreshCw size={14} />重新加载</button></div>}
    {state === 'ready' && settings && <>
      <div className={`v2-model-status ${settings.configured ? 'is-configured' : ''}`}>
        <span>{settings.configured && <Check size={14} />}{settings.configured ? '已配置' : '未配置'}</span>
        <small>仅当前服务会话</small>
      </div>
      <form className="v2-model-settings-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <label>服务
          <select value={preset} onChange={(event) => {
            const next = event.target.value as 'kimi-k3' | 'custom'
            setPreset(next)
            setActionState('idle')
            setActionMessage('')
            if (next === 'kimi-k3') {
              setBaseUrl(KIMI_BASE_URL)
              setModel(KIMI_MODEL)
            }
          }}>
            <option value="kimi-k3">Kimi K3</option>
            <option value="custom">自定义 OpenAI 兼容服务</option>
          </select>
        </label>
        <label>服务地址
          <input type="url" value={baseUrl} disabled={preset === 'kimi-k3'} placeholder="https://api.example.com/v1" onChange={(event) => { setBaseUrl(event.target.value); setActionState('idle') }} />
        </label>
        <label>模型 ID
          <input value={model} disabled={preset === 'kimi-k3'} placeholder="model-name" onChange={(event) => { setModel(event.target.value); setActionState('idle') }} />
        </label>
        <label>API Key
          <span className="v2-secret-input">
            <input type={showKey ? 'text' : 'password'} value={apiKey} disabled={clearApiKey} autoComplete="off" spellCheck={false} placeholder={settings.hasApiKey ? '已设置，留空则保持不变' : '可选'} onChange={(event) => { setApiKey(event.target.value); setActionState('idle') }} />
            <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} title={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </span>
        </label>
        {settings.hasApiKey && <label className="v2-model-clear-key"><input type="checkbox" checked={clearApiKey} onChange={(event) => { setClearApiKey(event.target.checked); setActionState('idle') }} />移除已存密钥</label>}
        {actionMessage && <p className={`v2-model-action-message ${actionState === 'error' ? 'is-error' : ''}`} role="status">{actionMessage}</p>}
        <footer>
          <button className="v2-secondary-button" type="button" disabled={!valid || busy} onClick={() => void testConnection()}>{actionState === 'testing' ? '测试中…' : '测试连接'}</button>
          <button className="v2-primary-button" type="submit" disabled={!valid || busy}>{actionState === 'saving' ? '保存中…' : '保存设置'}</button>
        </footer>
      </form>
    </>}
  </aside>
}

export default function ModelSettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    setErrorMessage('')
    try {
      setSettings(await v2Api.getModelSettings())
      setState('ready')
    } catch (error) {
      setState('error')
      setErrorMessage(messageFor(error))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return <ModelSettingsView
    settings={settings}
    state={state}
    errorMessage={errorMessage}
    onClose={onClose}
    onReload={() => void load()}
    onTest={(input) => v2Api.testModelSettings(input)}
    onSave={async (input) => {
      const saved = await v2Api.saveModelSettings(input)
      setSettings(saved)
      return saved
    }}
  />
}
