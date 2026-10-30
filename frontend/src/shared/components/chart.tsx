import { useEffect, useRef } from 'react'
import {
  init,
  use as registerCharts,
  type EChartsCoreOption,
} from 'echarts/core'
import {
  BarChart,
  LineChart,
  RadarChart,
  CustomChart,
  ScatterChart,
} from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  TitleComponent,
  RadarComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { scaleChartFonts } from '../typography'

registerCharts([
  BarChart,
  LineChart,
  RadarChart,
  CustomChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  TitleComponent,
  RadarComponent,
  MarkLineComponent,
  CanvasRenderer,
])

export function Chart({
  option,
  label,
  onClick,
}: {
  option: EChartsCoreOption
  label: string
  onClick?: (event: { name?: string }) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const chart = init(container.current!)
    chart.setOption(scaleChartFonts(option))
    if (onClick) chart.on('click', (event) => onClick(event))
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container.current!)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [option, onClick])
  return (
    <div
      ref={container}
      className="financial-chart"
      role="img"
      aria-label={label}
    />
  )
}
