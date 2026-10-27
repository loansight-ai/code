param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$PnpmPath,
    [Parameter(Mandatory = $true)][int]$Port
)
$ErrorActionPreference = 'Stop'
try {
    Set-Location -LiteralPath (Join-Path $ProjectRoot 'frontend')
    & $PnpmPath run dev --host 127.0.0.1 --port $Port --strictPort
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 1
}
