// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, useState } from 'react'
import { ROUTES, isRouteAvailable, useRouteStore, type RouteId } from '@/stores/routeStore'
import { THEME_META, useThemeStore } from '@/stores/themeStore'
import type { MotionMode, ThemeId } from '@/stores/themeStore'
import { Dot } from '@/components/primitives'
import { useI18n } from '@/i18n/useI18n'
import { useLocaleStore } from '@/stores/localeStore'
import { Menu, X, Play, Image, Activity, ListOrdered, Layers, Cpu, Palette } from 'lucide-react'

type Health = 'unknown' | 'ok' | 'down'

export function Topbar() {
  const { t, language } = useI18n()
  const setLanguage = useLocaleStore((s) => s.setLanguage)
  const route = useRouteStore((s) => s.route)
  const navigate = useRouteStore((s) => s.navigate)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const motionMode = useThemeStore((s) => s.motionMode)
  const setMotionMode = useThemeStore((s) => s.setMotionMode)
  const trainingActive = useThemeStore((s) => s.trainingActive)
  const motionLabel = { auto: t('topbar.motion.auto'), full: t('topbar.motion.full'), eco: t('topbar.motion.eco') } as Record<MotionMode, string>

  const [health, setHealth] = useState<Health>('unknown')
  const [mode, setMode] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const ping = async () => {
      try {
        const r = await fetch('/health', { cache: 'no-store' })
        const j = (await r.json()) as { status?: string; mode?: string }
        if (!alive) return
        setHealth(j.status === 'ok' ? 'ok' : 'down')
        setMode(j.mode ?? '')
      } catch {
        if (alive) setHealth('down')
      }
    }
    void ping()
    const interval = window.setInterval(ping, 12000)
    return () => {
      alive = false
      window.clearInterval(interval)
    }
  }, [])

  // 抽屉无障碍 Escape 与 Focus Trap 管理
  useEffect(() => {
    if (!drawerOpen) return
    const drawerEl = drawerRef.current

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setDrawerOpen(false)
        menuButtonRef.current?.focus()
        return
      }

      if (e.key === 'Tab' && drawerEl) {
        const focusable = drawerEl.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first || !drawerEl.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !drawerEl.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => {
      drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus()
    }, 50)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  const ecoNow = motionMode === 'eco' || (motionMode === 'auto' && trainingActive)
  const cycleMotion = () => {
    const order: MotionMode[] = ['auto', 'full', 'eco']
    setMotionMode(order[(order.indexOf(motionMode) + 1) % order.length])
  }

  const handleNav = (id: RouteId, e?: React.MouseEvent) => {
    e?.preventDefault()
    navigate(id)
    setDrawerOpen(false)
  }

  // 统一路由可见性：dev 路由在生产构建下彻底不可达，开发下也仅当前正处于该页面时可见
  const visibleRoutes = ROUTES.filter((r) => isRouteAvailable(r.id) && (!r.dev || route === r.id))

  const getRouteIcon = (id: RouteId) => {
    switch (id) {
      case 'train': return <Play size={14} />
      case 'generate': return <Image size={14} />
      case 'monitor': return <Activity size={14} />
      case 'queue': return <ListOrdered size={14} />
      case 'resources': return <Layers size={14} />
      case 'gallery': return <Palette size={14} />
      default: return <Cpu size={14} />
    }
  }

  return (
    <>
      <header className="lx-topbar">
        <div className="lx-topbar-left">
          <button
            ref={menuButtonRef}
            type="button"
            className="lx-mobile-menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
          >
            <Menu size={18} />
          </button>
          <a
            href="#/train"
            className="lx-brand"
            onClick={(e) => handleNav('train', e)}
            aria-label="Lulynx Studio Home"
          >
            <span className="lx-brand-mark" />
            <div className="lx-brand-text">
              <span className="lx-brand-name">LULYNX</span>
              <span className="lx-brand-sub">STUDIO</span>
            </div>
          </a>
          <nav className="lx-nav" aria-label="Main Navigation">
            {visibleRoutes.map((r) => (
              <a
                key={r.id}
                href={`#/${r.id}`}
                aria-current={route === r.id ? 'page' : undefined}
                className={['lx-nav-item', route === r.id ? 'on' : ''].filter(Boolean).join(' ')}
                onClick={(e) => handleNav(r.id, e)}
              >
                {getRouteIcon(r.id)}
                <span>{language === 'en' ? r.en : r.zh}</span>
              </a>
            ))}
          </nav>
        </div>

        <div className="lx-topbar-right">
          <span className="lx-conn" title={mode ? `backend mode: ${mode}` : t('topbar.backend_down')}>
            <Dot tone={health === 'ok' ? 'ok' : health === 'down' ? 'danger' : 'warn'} pulse={health === 'ok'} />
            {health === 'ok' ? `LINK·${mode || 'OK'}` : health === 'down' ? 'OFFLINE' : '…'}
          </span>
          <div className="lx-lang-seg" role="group" aria-label="Language selection">
            <button type="button" className={language === 'zh' ? 'on' : ''} onClick={() => setLanguage('zh')}>中</button>
            <button type="button" className={language === 'en' ? 'on' : ''} onClick={() => setLanguage('en')}>EN</button>
          </div>
          <div className="lx-theme-seg" role="group" aria-label={t('topbar.theme')}>
            {(Object.keys(THEME_META) as ThemeId[]).map((id) => (
              <button key={id} type="button" className={theme === id ? 'on' : ''} onClick={() => setTheme(id)} title={THEME_META[id].zh}>
                {THEME_META[id].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={['lx-motion-btn', ecoNow ? 'eco' : ''].filter(Boolean).join(' ')}
            onClick={cycleMotion}
            title={t('topbar.motion_hint')}
          >
            {motionLabel[motionMode]}
          </button>
        </div>
      </header>

      {/* 移动端侧滑抽屉 */}
      {drawerOpen && (
        <div
          className="lx-mobile-drawer-backdrop"
          onClick={() => {
            setDrawerOpen(false)
            menuButtonRef.current?.focus()
          }}
        >
          <div
            ref={drawerRef}
            className="lx-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lx-mobile-drawer-head">
              <a
                href="#/train"
                className="lx-brand"
                onClick={(e) => handleNav('train', e)}
              >
                <span className="lx-brand-mark" />
                <span className="lx-brand-name">LULYNX</span>
              </a>
              <button
                type="button"
                className="lx-btn sm ghost"
                onClick={() => {
                  setDrawerOpen(false)
                  menuButtonRef.current?.focus()
                }}
                aria-label="Close navigation drawer"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="lx-mobile-drawer-nav" aria-label="Mobile Drawer Links">
              {visibleRoutes.map((r) => (
                <a
                  key={r.id}
                  href={`#/${r.id}`}
                  aria-current={route === r.id ? 'page' : undefined}
                  className={['lx-nav-item', route === r.id ? 'on' : ''].filter(Boolean).join(' ')}
                  onClick={(e) => handleNav(r.id, e)}
                >
                  {getRouteIcon(r.id)}
                  <span>{language === 'en' ? r.en : r.zh}</span>
                </a>
              ))}
            </nav>
            <div className="lx-mobile-drawer-foot">
              <div className="lx-drawer-foot-row">
                <span className="lx-drawer-label">{t('topbar.theme')}</span>
                <div className="lx-theme-seg" role="group">
                  {(Object.keys(THEME_META) as ThemeId[]).map((id) => (
                    <button key={id} type="button" className={theme === id ? 'on' : ''} onClick={() => setTheme(id)}>
                      {THEME_META[id].zh}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lx-drawer-foot-row">
                <span className="lx-drawer-label">Language</span>
                <div className="lx-lang-seg" role="group">
                  <button type="button" className={language === 'zh' ? 'on' : ''} onClick={() => setLanguage('zh')}>中文</button>
                  <button type="button" className={language === 'en' ? 'on' : ''} onClick={() => setLanguage('en')}>EN</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 极窄屏底部导航栏 */}
      <nav className="lx-bottom-nav" aria-label="Mobile Bottom Navigation">
        {ROUTES.filter((r) => !r.dev).map((r) => (
          <a
            key={r.id}
            href={`#/${r.id}`}
            aria-current={route === r.id ? 'page' : undefined}
            className={['lx-bottom-nav-item', route === r.id ? 'on' : ''].filter(Boolean).join(' ')}
            onClick={(e) => handleNav(r.id, e)}
          >
            {getRouteIcon(r.id)}
            <span>{language === 'en' ? r.en : r.zh}</span>
          </a>
        ))}
      </nav>
    </>
  )
}


