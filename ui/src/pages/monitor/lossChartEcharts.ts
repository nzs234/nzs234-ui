// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* echarts/core 按需注册单一入口。本模块是 vendor-echarts chunk 的唯一静态边界：
   LossChart 通过 import() 懒加载这里；注册用**静态具名导入**（命名空间动态
   import 会让 Rollup 无法证明只用了 LineChart，从而把全部图表/组件留进产物）。 */
/* 别名 registerEcharts:echarts 的 `use` 与 React 的 `use` hook 同名,直接调用会被
   react-hooks 规则判成「在组件外调用 hook」。改名比加 eslint-disable 更准确。 */
import { use as registerEcharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

registerEcharts([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export * from 'echarts/core'
