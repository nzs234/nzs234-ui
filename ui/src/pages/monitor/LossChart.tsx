// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import type { ChartPoint } from '@/stores/monitorStore'
import { isEcoMotion, useThemeStore } from '@/stores/themeStore'
import type * as EchartsCore from './lossChartEcharts'

/* Loss/LR 双序列曲线,echarts 懒加载(vendor-echarts chunk),配色取当前主题 CSS 变量 */

/* 按需注册见 ./lossChartEcharts.ts：只装 LineChart + Grid/Tooltip/Legend +
   Canvas 渲染器（5.x 全量引入实测 vendor 1042KB / gzip 345KB）。注册幂等，
   theme 变化重复 loadEcharts 不会叠加。 */
let echartsCorePromise: Promise<typeof EchartsCore> | null = null

function loadEcharts() {
  echartsCorePromise ||= import('./lossChartEcharts')
  return echartsCorePromise
}

export function LossChart({ loss, lr }: { loss: ChartPoint[]; lr: ChartPoint[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const theme = useThemeStore((s) => s.theme)
  const [ready, setReady] = useState(0)

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | undefined
    void loadEcharts().then((echarts) => {
      if (disposed || !ref.current) return
      chartRef.current?.dispose()
      const chart = echarts.init(ref.current)
      chartRef.current = chart
      ro = new ResizeObserver(() => chart.resize())
      ro.observe(ref.current)
      setReady((n) => n + 1)
    })
    return () => {
      disposed = true
      ro?.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [theme])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !ready) return
    const css = getComputedStyle(document.documentElement)
    const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb
    const accent = v('--lx-accent', '#ff4400')
    const dim = v('--lx-dim', '#888')
    const border = v('--lx-border', 'rgba(128,128,128,.3)')
    const mono = v('--lx-font-mono', 'monospace')
    const axis = {
      axisLine: { lineStyle: { color: border } },
      axisLabel: { color: dim, fontFamily: mono, fontSize: 10 },
      splitLine: { lineStyle: { color: border, opacity: 0.4 } },
    }
    chart.setOption(
      {
        animation: !isEcoMotion(),
        animationDuration: 300,
        grid: { left: 52, right: 56, top: 26, bottom: 30 },
        tooltip: {
          trigger: 'axis',
          backgroundColor: v('--lx-panel', '#111'),
          borderColor: border,
          textStyle: { color: v('--lx-text', '#eee'), fontFamily: mono, fontSize: 11 },
          valueFormatter: (val: unknown) => (typeof val === 'number' ? val.toPrecision(4) : String(val ?? '')),
        },
        legend: {
          top: 0,
          right: 0,
          icon: 'rect',
          itemWidth: 10,
          itemHeight: 3,
          textStyle: { color: dim, fontFamily: mono, fontSize: 10 },
        },
        xAxis: { type: 'value', name: 'STEP', nameTextStyle: { color: dim, fontFamily: mono, fontSize: 9 }, min: 'dataMin', max: 'dataMax', ...axis },
        yAxis: [
          { type: 'value', scale: true, ...axis },
          { type: 'value', scale: true, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: (n: number) => n.toExponential(0) } },
        ],
        series: [
          {
            name: 'LOSS',
            type: 'line',
            showSymbol: false,
            data: loss.map((p) => [p.step, p.value]),
            lineStyle: { color: accent, width: 2 },
            itemStyle: { color: accent },
            emphasis: { disabled: true },
          },
          {
            name: 'LR',
            type: 'line',
            yAxisIndex: 1,
            showSymbol: false,
            data: lr.map((p) => [p.step, p.value]),
            lineStyle: { color: dim, width: 1, type: 'dashed' },
            itemStyle: { color: dim },
            emphasis: { disabled: true },
          },
        ],
      },
      { notMerge: true },
    )
  }, [loss, lr, ready, theme])

  return <div ref={ref} className="lx-chart" />
}
