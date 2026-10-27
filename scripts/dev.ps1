$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-common.ps1')

$managerLock = $null
$result = 0
try {
    $action = $args[0]
    $options = @(Read-DevOptions -Action $action -Options @($args | Select-Object -Skip 1))
    if ($options[0].Help) {
        Write-Host 'start.cmd [--backend | --frontend] [--restart]'
        Write-Host 'stop.cmd  [--backend | --frontend]'
        Write-Host 'No selection means both. Backend includes API and PostgreSQL.'
        exit 0
    }
    $projectRoot = Split-Path $PSScriptRoot -Parent
    $runDirectory = Join-Path $projectRoot '.run'
    New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
    try {
        $managerLock = [System.IO.File]::Open(
            (Join-Path $runDirectory 'manager.lock'), 'OpenOrCreate', 'ReadWrite', 'None'
        )
    } catch {
        throw 'Another start/stop operation is running. Try again after it finishes.'
    }
    foreach ($target in $options[0].Targets) {
        try {
            if ($target -eq 'backend') {
                Invoke-Backend -ProjectRoot $projectRoot -Action $action -Restart $options[0].Restart
            } else {
                Invoke-Frontend -ProjectRoot $projectRoot -Action $action -Restart $options[0].Restart
            }
        } catch {
            Write-Host "[$target] ERROR: $($_.Exception.Message)" -ForegroundColor Red
            $result = 1
        }
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $result = 1
} finally {
    if ($null -ne $managerLock) { $managerLock.Dispose() }
}
exit $result
