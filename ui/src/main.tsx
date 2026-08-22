// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import './theme/tokens.css'
import './theme/base.css'
import './theme/components.css'
import './theme/themes/editorial.css'
import './theme/themes/acid.css'
import './theme/themes/glass.css'
import './theme/tw.css'
import './app/app.css'
import { initTheme } from './stores/themeStore'
import { AppShell } from './app/AppShell'
import { installGlobalErrorReporter } from './api/transport'

initTheme()
installGlobalErrorReporter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
)

