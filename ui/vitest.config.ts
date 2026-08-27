// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      // text 给 CI 日志看，html/lcov 给本地和后续工具消费。
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/api/**/*.ts',
        'src/features/**/*.ts',
        'src/lib/**/*.ts',
        'src/schema/**/*.js',
        'src/stores/**/*.ts',
        'src/utils/**/*.ts',
        'src/pages/train/wizard/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        'src/test/**',
        // 快照式的静态 schema 表，没有分支可覆盖，计进去只会稀释信号。
        'src/schema/schemaFieldGroups.js',
      ],
      // 故意不设 thresholds：当前基线还没量过，设死数字只会变成噪音门禁。
      all: false,
      // 已知的 CONTRACT 用例会失败；不打开这个开关的话 coverage 报告根本不会产出。
      reportOnFailure: true,
    },
  },
})
