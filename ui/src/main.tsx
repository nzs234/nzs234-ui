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
/* V2 皮肤层必须最后导入:与 html[data-theme=*] 主题层同特异性,靠层叠顺序在 V2 下整体接管 */
import './theme/v2/v2.css'
import { initTheme } from './stores/themeStore'
import { initUiVersion } from './stores/uiVersionStore'
import { AppShell } from './app/AppShell'
import { installGlobalErrorReporter } from './api/transport'

initTheme()
initUiVersion()
installGlobalErrorReporter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
)

