import { useEffect, useRef } from 'react'
import {
  init,
  use as registerCharts,
  type EChartsCoreOption,
} from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { scaleChartFonts } from '../typography'

registerCharts([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

export function Chart({
  option,
  label,
}: {
  option: EChartsCoreOption
  label: string
}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const chart = init(container.current!)
    chart.setOption(scaleChartFonts(option))
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container.current!)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [option])
  return (
    <div
      ref={container}
      className="financial-chart"
      role="img"
      aria-label={label}
    />
  )
}
