param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$PnpmPath,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][int]$Port
)
$ErrorActionPreference = 'Stop'
try {
    $env:Path = "$(Split-Path $NodePath -Parent);$(Split-Path $PnpmPath -Parent);$env:Path"
    Set-Location -LiteralPath (Join-Path $ProjectRoot 'frontend')
    & $PnpmPath run dev --host 127.0.0.1 --port $Port --strictPort
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 1
}
