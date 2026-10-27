function Read-DevOptions {
    param([string]$Action, [string[]]$Options)
    if ($Action -notin @('start', 'stop')) { throw 'Expected start or stop.' }
    $selected = @()
    $restart = $false
    $helpRequested = $false
    foreach ($option in $Options) {
        switch -CaseSensitive ($option) {
            '--backend' { $selected += 'backend' }
            '--frontend' { $selected += 'frontend' }
            '--restart' {
                if ($Action -ne 'start') { throw '--restart is only supported by start.' }
                $restart = $true
            }
            '--help' { $helpRequested = $true }
            default { throw "Unknown option: $option. Use --help." }
        }
    }
    if ($selected.Count -gt 1) { throw '--backend and --frontend are mutually exclusive; select once.' }
    if ($selected.Count -eq 0) { $selected = @('backend', 'frontend') }
    return [PSCustomObject]@{ Targets = $selected; Restart = $restart; Help = $helpRequested }
}

function Invoke-Compose {
    param([string]$ProjectRoot, [string[]]$ComposeArguments)
    $output = & docker.exe compose -f (Join-Path $ProjectRoot 'deploy/compose.yaml') @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed (exit $LASTEXITCODE)." }
    return $output
}

function Invoke-Backend {
    param([string]$ProjectRoot, [string]$Action, [bool]$Restart)
    if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
        throw 'Docker is not installed. Install Docker Desktop first.'
    }
    $null = & docker.exe info --format '{{.ServerVersion}}' 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Docker engine is unavailable. Start Docker Desktop first.' }
    $services = @('api', 'worker', 'outbox-relay', 'rabbitmq', 'db')
    $running = @(Invoke-Compose $ProjectRoot (@('ps', '--status', 'running', '-q') + $services))
    if ($Action -eq 'stop') {
        if ($running.Count -eq 0) { Write-Host '[backend] Already stopped.'; return }
        Invoke-Compose $ProjectRoot (@('stop') + $services) | Out-Host
        Write-Host '[backend] Stopped API, Worker, Relay, RabbitMQ and PostgreSQL. Data is preserved.'
        return
    }
    if ($running.Count -eq $services.Count -and -not $Restart) {
        $health = @(& docker.exe inspect --format '{{.State.Health.Status}}' @running)
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect backend container health.' }
        if (@($health | Where-Object { $_ -ne 'healthy' }).Count -eq 0) {
            Write-Host '[backend] Already running (all five services healthy). Use --restart to restart.'
            return
        }
        Write-Host '[backend] Running but not ready; waiting for healthy services.'
    }
    $composeArguments = @('up', '-d', '--build', '--wait', '--wait-timeout', '120')
    if ($Restart) { $composeArguments += '--force-recreate' }
    $composeArguments += @('db', 'rabbitmq', 'migrate', 'api', 'worker', 'outbox-relay')
    Invoke-Compose $ProjectRoot $composeArguments | Out-Host
    $apiPort = '8000'
    if ($env:LOANSIGHT_API_PORT) { $apiPort = $env:LOANSIGHT_API_PORT }
    Write-Host "[backend] Ready: http://localhost:$apiPort/docs (API + DB + MQ + Worker + Relay)."
}

function Get-FrontendPort {
    $port = 5173
    if ($env:LOANSIGHT_FRONTEND_PORT -and
        (-not [int]::TryParse($env:LOANSIGHT_FRONTEND_PORT, [ref]$port) -or
        $port -lt 1 -or $port -gt 65535)) {
        throw 'LOANSIGHT_FRONTEND_PORT must be an integer from 1 to 65535.'
    }
    return $port
}

function Test-LocalPort {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connection = $client.ConnectAsync('127.0.0.1', $Port)
        return ($connection.Wait(300) -and $client.Connected)
    } catch { return $false } finally { $client.Dispose() }
}

function Get-FrontendProcess {
    param([string]$ProjectRoot)
    $statePath = Join-Path $ProjectRoot '.run/frontend.json'
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $process = Get-Process -Id $state.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process -or
        $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.StartedTicks -or
        $state.ProjectRoot -ne $ProjectRoot) {
        Remove-Item -LiteralPath $statePath -Force
        return $null
    }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    $runnerPath = Join-Path $ProjectRoot 'scripts/frontend-runner.ps1'
    if (-not $details.CommandLine -or
        $details.CommandLine.IndexOf($runnerPath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'Frontend PID belongs to another process. Refusing to stop it.'
    }
    return [PSCustomObject]@{ Process = $process; Port = [int]$state.Port }
}

function Stop-Frontend {
    param([string]$ProjectRoot, $Managed)
    if ($null -eq $Managed) { Write-Host '[frontend] Already stopped (no managed process).'; return }
    # Identity and creation time were checked before terminating this specific process tree.
    & taskkill.exe /PID $Managed.Process.Id /T /F | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the frontend process tree.' }
    Remove-Item -LiteralPath (Join-Path $ProjectRoot '.run/frontend.json') -Force
    Write-Host '[frontend] Stopped.'
}

function Invoke-Frontend {
    param([string]$ProjectRoot, [string]$Action, [bool]$Restart)
    $managed = Get-FrontendProcess $ProjectRoot
    if ($Action -eq 'stop') { Stop-Frontend $ProjectRoot $managed; return }
    $port = Get-FrontendPort
    if ($null -ne $managed -and -not $Restart) {
        if (Test-LocalPort $managed.Port) {
            Write-Host "[frontend] Already running: http://localhost:$($managed.Port). Use --restart to restart."
            return
        }
        throw 'Managed frontend is running but not listening. Check .run/frontend.*.log or use --restart.'
    }
    $packagePath = Join-Path $ProjectRoot 'frontend/package.json'
    if (-not (Test-Path -LiteralPath $packagePath)) {
        Write-Host '[frontend] Not implemented: frontend/package.json is missing; skipped.' -ForegroundColor Yellow
        return
    }
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if (-not $package.scripts.dev) { throw 'frontend/package.json must define a dev script (Vite).' }
    $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $pnpm) { throw 'pnpm.cmd is not installed or not on PATH.' }
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'frontend/node_modules'))) {
        throw 'Frontend dependencies are missing. Run pnpm install in frontend/ first.'
    }
    if ($null -ne $managed) { Stop-Frontend $ProjectRoot $managed }
    if (Test-LocalPort $port) {
        throw "Port $port is already in use by an unmanaged process. Stop it manually or change LOANSIGHT_FRONTEND_PORT."
    }
    $runner = Join-Path $ProjectRoot 'scripts/frontend-runner.ps1'
    $runDirectory = Join-Path $ProjectRoot '.run'
    $process = Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$runner`"", '-ProjectRoot', "`"$ProjectRoot`"",
        '-PnpmPath', "`"$($pnpm.Source)`"", '-Port', $port
    ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (
        Join-Path $runDirectory 'frontend.stdout.log'
    ) -RedirectStandardError (Join-Path $runDirectory 'frontend.stderr.log')
    try {
        @{
            ProjectRoot = $ProjectRoot; ProcessId = $process.Id; Port = $port
            StartedTicks = $process.StartTime.ToUniversalTime().Ticks.ToString()
        } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'frontend.json') -Encoding UTF8
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ([DateTime]::UtcNow -lt $deadline) {
            $process.Refresh()
            if ($process.HasExited) { throw 'Frontend exited during startup. Check .run/frontend.*.log.' }
            if (Test-LocalPort $port) {
                Write-Host "[frontend] Ready: http://localhost:$port. Logs: .run/frontend.*.log"
                return
            }
            Start-Sleep -Milliseconds 300
        }
        throw 'Frontend did not start within 30 seconds. Check .run/frontend.*.log.'
    } catch {
        $startupError = $_
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Frontend $ProjectRoot (Get-FrontendProcess $ProjectRoot) }
        else { Remove-Item -LiteralPath (Join-Path $runDirectory 'frontend.json') -Force -ErrorAction SilentlyContinue }
        throw $startupError
    }
}
