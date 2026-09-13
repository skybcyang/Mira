import { useEffect, useState } from 'react'
import { version } from '../../package.json'

export function ApplicationInfo() {
  const [desktop, setDesktop] = useState<{ version: string; platform: string; architecture: string }>()
  useEffect(() => {
    const controller = new AbortController()
    fetch('/graphmind/api/v2/application-info', { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(info => { if (!controller.signal.aborted && info?.desktop) setDesktop(info) }, () => {})
    return () => controller.abort()
  }, [])
  return <div className="v2-application-info"><p>Mira {desktop?.version || version}{desktop ? ` · ${desktop.platform === 'darwin' ? 'macOS' : 'Windows'} ${desktop.architecture === 'arm64' ? 'ARM64' : 'Intel / AMD 64 位'}` : ' · 浏览器版'}</p>
    <a href="https://github.com/skybcyang/Mira/releases" target="_blank" rel="noreferrer">查看官方发行版本</a>
    <p>手动下载与更换应用。更换前保存工作、结束运行并备份；不会自动下载或安装更新。</p>
  </div>
}
