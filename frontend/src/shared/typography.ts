import type { EChartsCoreOption } from 'echarts/core'

export function scaledFontSize(size: number) {
  const scale = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--font-scale'),
  )
  return size * (Number.isFinite(scale) && scale > 0 ? scale : 1)
}

type Options = Record<string, unknown>
function scaleExplicitFonts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scaleExplicitFonts)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      key === 'fontSize' && typeof v === 'number'
        ? scaledFontSize(v)
        : scaleExplicitFonts(v),
    ]),
  )
}

// Canvas text and source iframes do not inherit the application's CSS font sizes.
export function scaleChartFonts(option: EChartsCoreOption): EChartsCoreOption {
  const scaled = scaleExplicitFonts(option) as Options
  const patch = (key: string, update: (item: Options) => Options) => {
    const value = scaled[key]
    if (value !== undefined)
      scaled[key] = Array.isArray(value)
        ? value.map((v) => update(v as Options))
        : update(value as Options)
  }
  const text = (value: unknown, size = 12) => ({
    fontSize: scaledFontSize(size),
    ...(value as Options),
  })
  scaled.textStyle = text(scaled.textStyle)
  for (const key of ['xAxis', 'yAxis'])
    patch(key, (axis) => ({
      ...axis,
      axisLabel: text(axis.axisLabel),
      nameTextStyle: text(axis.nameTextStyle),
    }))
  patch('legend', (legend) => ({
    ...legend,
    textStyle: text(legend.textStyle),
  }))
  patch('tooltip', (tooltip) => ({
    ...tooltip,
    textStyle: text(tooltip.textStyle, 14),
  }))
  patch('series', (series) => ({ ...series, label: text(series.label) }))
  return scaled
}
