import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyAppearance, browserAppearance } from './v2/appearance'
import './styles.css'

applyAppearance(document.documentElement, browserAppearance())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
