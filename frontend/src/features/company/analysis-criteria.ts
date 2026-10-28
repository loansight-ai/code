// Restore the previous panel's year choices; these are not verified DART filings.
export const reportYears = ['2025', '2024', '2023'] as const
export const reports = reportYears.map((year) => `${year} 사업보고서`)
