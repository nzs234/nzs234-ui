// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 铁律(launcher 踩坑经验):启动链依赖(react/scheduler/zustand/gsap 等)必须合并单一 vendor,
// 互相 import 的包拆开会产生循环 chunk → React 导出对象初始化错乱、白屏。
// 仅"只被懒加载页引用"的单向重依赖(echarts)可独立分包。
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 3010,
    proxy: {
      '/api': { target: 'http://127.0.0.1:28000', changeOrigin: true },
      '/train': { target: 'http://127.0.0.1:28000', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:28000', changeOrigin: true },
      '/local': { target: 'http://127.0.0.1:28000', changeOrigin: true },
      '/proxy': { target: 'http://127.0.0.1:28000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:28000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('vite/preload-helper')) return 'preload-helper'
          if (id.includes('node_modules')) {
            if (/[\\/]node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return 'vendor-echarts'
            return 'vendor'
          }
        },
      },
    },
  },
})
