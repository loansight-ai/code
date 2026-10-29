// Match the server's bounded rowspan/colspan grid without trusting source attributes.
export function findSourceCell(
  table: HTMLTableElement | null,
  row: number,
  column: number,
) {
  if (
    !table ||
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    column < 0 ||
    column >= 500 ||
    table.rows.length > 200000
  )
    return null
  const grid: HTMLTableCellElement[][] = []
  let occupied = 0
  for (let r = 0; r < table.rows.length; r++) {
    grid[r] ??= []
    let col = 0
    for (const cell of Array.from(table.rows[r].cells)) {
      while (grid[r][col]) col++
      const height = cell.rowSpan,
        width = cell.colSpan
      if (
        height < 1 ||
        height > 500 ||
        width < 1 ||
        width > 100 ||
        col + width > 500 ||
        occupied + height * width > 200000
      )
        return null
      for (let dr = 0; dr < height; dr++) {
        grid[r + dr] ??= []
        for (let dc = 0; dc < width; dc++) {
          if (grid[r + dr][col + dc]) return null
          grid[r + dr][col + dc] = cell
          occupied++
        }
      }
      col += width
    }
  }
  return grid[row]?.[column] ?? null
}
