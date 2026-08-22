// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { Component, useEffect, type ReactNode } from 'react'
import { bootstrapRunHistory } from '@/stores/historyStore'
import { Topbar } from './Topbar'
import { PageHost } from './PageHost'
import { ToastHost } from '@/components/overlay'
import { useRouteStore } from '@/stores/routeStore'
import { Button } from '@/components/primitives'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught render error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--lx-bg)' }}>
          <div style={{ maxWidth: 480, width: '100%', padding: 24, background: 'var(--lx-surface)', border: '1px solid var(--lx-danger)', borderRadius: 10, textAlign: 'center' }}>
            <AlertCircle size={36} color="var(--lx-danger)" style={{ margin: '0 auto 12px' }} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--lx-text)', marginBottom: 8 }}>界面渲染异常 / Render Error</h2>
            <p style={{ fontSize: 12, color: 'var(--lx-dim)', marginBottom: 16, lineHeight: 1.5, wordBreak: 'break-word', fontFamily: 'var(--lx-font-mono)' }}>
              {this.state.error?.message || '未知前端渲染错误'}
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
            >
              <RefreshCw size={13} style={{ marginRight: 4 }} />
              刷新页面 / Reload Studio
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export function AppShell() {
  const syncFromHash = useRouteStore((s) => s.syncFromHash)

  useEffect(() => {
    const onHash = () => syncFromHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [syncFromHash])

  // 启动时 bootstrap 运行历史(磁盘 → LS merge，单飞与并发幂等)
  useEffect(() => {
    void bootstrapRunHistory()
  }, [])

  return (
    <AppErrorBoundary>
      <Topbar />
      <main className="lx-main">
        <PageHost />
      </main>
      <ToastHost />
    </AppErrorBoundary>
  )
}


