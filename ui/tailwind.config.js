// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lx: {
          bg: 'var(--lx-bg)',
          'bg-soft': 'var(--lx-bg-soft)',
          surface: 'var(--lx-surface-color)',
          'surface-2': 'var(--lx-surface-2)',
          border: 'var(--lx-border)',
          'border-strong': 'var(--lx-border-strong)',
          text: 'var(--lx-text)',
          dim: 'var(--lx-dim)',
          accent: 'var(--lx-accent)',
          'accent-contrast': 'var(--lx-accent-contrast)',
          ok: 'var(--lx-ok)',
          warn: 'var(--lx-warn)',
          danger: 'var(--lx-danger)'
        }
      },
      fontFamily: {
        display: 'var(--lx-font-display)',
        mono: 'var(--lx-font-mono)'
      }
    }
  },
  plugins: []
}
