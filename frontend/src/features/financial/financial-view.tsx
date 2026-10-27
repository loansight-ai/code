import { useEffect, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { init, use as registerCharts } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { financialRows } from '../company/demo-data'

registerCharts([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])
const columns: ColumnDef<(typeof financialRows)[number]>[] = [
  { accessorKey: 'name', header: '계정' },
  ...(['y2023', 'y2024', 'y2025'] as const).map((key) => ({
    accessorKey: key,
    header: `${key.slice(1)}년`,
    cell: ({ getValue }: { getValue: () => unknown }) =>
      Number(getValue()).toLocaleString('ko-KR'),
  })),
]

export function FinancialView() {
  const [sorting, setSorting] = useState<SortingState>([])
  // React Compiler is not enabled; Table v8's mutable API is intentional here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: financialRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const chartRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const chart = init(chartRef.current!)
    chart.setOption({
      color: ['#FFBC00', '#60584C'],
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, icon: 'circle' },
      grid: { left: 50, right: 45, top: 30, bottom: 60 },
      xAxis: {
        type: 'category',
        data: ['2023', '2024', '2025'],
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#d9dbd5' } },
      },
      yAxis: [
        {
          type: 'value',
          name: '매출액 (억원)',
          splitLine: { lineStyle: { color: '#eceee8' } },
        },
        { type: 'value', name: '영업이익 (억원)', splitLine: { show: false } },
      ],
      series: [
        {
          name: '매출액',
          type: 'bar',
          barWidth: 38,
          data: financialRows[0].y2023 ? [1080, 1190, 1250] : [],
        },
        {
          name: '영업이익',
          type: 'line',
          yAxisIndex: 1,
          symbolSize: 8,
          data: [87, 94, 100],
        },
      ],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(chartRef.current!)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [])
  return (
    <div className="financial-layout">
      <section className="panel">
        <div className="panel-heading">
          <h2>3개년 실적 추이</h2>
          <span className="demo-label">가상 예시</span>
        </div>
        <div
          ref={chartRef}
          className="financial-chart"
          role="img"
          aria-label="예시 매출액은 2023년 1,080억원, 2024년 1,190억원, 2025년 1,250억원. 영업이익은 각각 87억원, 94억원, 100억원. 아래 표에서 같은 수치를 확인할 수 있습니다."
        />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>주요 재무 계정</h2>
          <span className="muted">단위: 억원 · 가상 예시</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      aria-sort={
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                    >
                      <button onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}{' '}
                        {header.column.getIsSorted() === 'asc'
                          ? '↑'
                          : header.column.getIsSorted() === 'desc'
                            ? '↓'
                            : '↕'}
                      </button>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-footnote">
          모든 기업·보고서·회계 범위에 공통으로 사용하는 레이아웃용 예시입니다.
        </p>
      </section>
    </div>
  )
}
