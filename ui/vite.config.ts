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
          // 训练族 schema 定义(~810KB 源码)是纯数据 + 纯函数,不 import 任何
          // node_modules,也不在启动链上 —— 上面那条"启动链依赖必须合并"的铁律
          // 不适用。强制独立分包的原因是它默认会被 rollup 与 components/layout
          // 这类全站共享模块塞进同一个 chunk:那样一来监控/队列/资源页只是为了
          // 一个 <Panel> 就得下载全量 schema。独立成 chunk 后,它只跟真正读
          // schema 的页面(训练页/向导)一起加载。
          if (/[\\/]src[\\/]schema[\\/]/.test(id)) return 'schema'
          // 按 field.key 索引的 EN 文案大包(labels/descs/options ~300KB):
          // 同理只服务 schema 字段渲染,单独成包避免混进入口或全站共享 chunk。
          if (/[\\/]src[\\/]i18n[\\/]schemaField/.test(id)) return 'i18n-schema-en'
        },
      },
    },
  },
})
