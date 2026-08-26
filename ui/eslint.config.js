// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * ESLint 9+ flat config。
 *
 * 定位:补 tsc 与 vitest 都覆盖不到的那层 —— React Hooks 依赖数组、
 * 明显的死代码/误用。刻意**不开** type-checked 规则集:本仓 src/schema/*.js
 * 是大量 allowJs 的 schema 定义(checkJs:false),开 type-aware lint 会为它们
 * 建整套 program,既慢又会淹没在 any 噪声里。类型正确性由 npm run build /
 * test:typecheck 负责,这里只管模式性错误。
 *
 * 为什么不 extends `@eslint/js` 的 recommended:本机 eslint 是 10.9.1,而
 * registry 上 @eslint/js 最新只到 10.0.1(版本错位),硬加会引入一个与 eslint
 * 主包不同步的依赖。核心规则改为在下方显式列出 —— 条目可数,也更清楚门禁到底管什么。
 */
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

/** 浏览器 + Node + vitest(--globals 运行,describe/expect 不经 import)。 */
const GLOBALS = Object.fromEntries(
  [
    'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
    'fetch', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
    'matchMedia', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver',
    'AbortController', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData',
    'Headers', 'Request', 'Response', 'EventSource', 'WebSocket', 'structuredClone',
    'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'HTMLTextAreaElement',
    'HTMLSelectElement', 'HTMLButtonElement', 'HTMLCanvasElement', 'SVGElement',
    'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'DragEvent', 'WheelEvent', 'FocusEvent', 'InputEvent', 'CSS', 'getComputedStyle',
    'process', 'globalThis', 'Buffer', '__dirname', '__filename',
    'describe', 'it', 'test', 'expect', 'vi', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  ].map((name) => [name, 'readonly']),
)

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**', 'public/**']),

  tseslint.configs.recommended,
  // 注意取 configs.flat.*:plugin 顶层的 configs.recommended 仍是 eslintrc 形状
  // (plugins 是字符串数组),flat config 只接受 configs.flat 下的对象形状。
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
  },

  {
    // 覆写层需自带 plugins:flat config 要求 rule 与其 plugin 在同一 config 对象里
    // 可见,不会从前面的 config 继承。
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: GLOBALS,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      // ── 真错误:能静默改变运行时行为的写法 ──
      'no-cond-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sparse-arrays': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      eqeqeq: ['error', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],

      // ── 可疑但有既有用法,先 warn 不阻塞 ──
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'warn',

      // 本仓的 store/轮询大量用「generation 计数器」在 await 后校验请求是否过期
      // (monitorStore.tickRun、GeneratePage.poll),规则看不见这层守卫,对模块级
      // 可变量一律报警。留 warn 保留信号,但不当门禁。
      'require-atomic-updates': 'warn',

      // 未使用变量:放行 _ 前缀(本仓大量 `_theme`、`(_, i) =>` 写法)。
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // schema / 后端 payload 边界上 any 是既有约定,由 runConfigBuilder 测试兜住。
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      // ── React Hooks:分两档 ──
      // rules-of-hooks / exhaustive-deps 是真 bug 源,保持规则集默认(error/warn)。
      // 其余几条来自 React Compiler 的严格分析(effect 内同步 setState、渲染期读
      // ref、纯度),本仓有约 30 处既有写法命中 —— 多是"派生 state 跟随 props 回落"
      // 这类可控模式。一次性重构不属于本次范围,降为 warn 让它们可见但不阻塞。
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/incompatible-library': 'warn',
    },
  },

  {
    // schema 定义与 tools 脚本是纯 JS/ESM,不适用 TS-only 的那几条。
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  {
    // 工具脚本就是靠 stdout 汇报的,no-console 在这里没有意义。
    files: ['tools/**/*.{js,mjs}', 'vite.config.ts', 'vitest.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },
])
