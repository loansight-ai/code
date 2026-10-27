$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-common.ps1')

try {
    if ($args.Count -gt 0) { throw 'Usage: setup-frontend.cmd (no options).' }
    $projectRoot = Split-Path $PSScriptRoot -Parent
    $frontend = Join-Path $projectRoot 'frontend'
    $package = Get-Content -LiteralPath (Join-Path $frontend 'package.json') -Raw | ConvertFrom-Json
    $nodeVersion = (Get-Content -LiteralPath (Join-Path $frontend '.node-version') -Raw).Trim()
    if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$' -or $package.packageManager -notmatch '^pnpm@(\d+\.\d+\.\d+)$') {
        throw 'frontend/.node-version and packageManager must pin Node.js and pnpm versions.'
    }
    $pnpmVersion = $Matches[1]
    $architecture = Get-NodeArchitecture
    $toolsDirectory = Join-Path $projectRoot '.tools'
    New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
    $setupLock = $null
    try {
        $setupLock = [System.IO.File]::Open((Join-Path $toolsDirectory 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        $archiveName = "node-v$nodeVersion-win-$architecture.zip"
        $nodeDirectory = Join-Path $toolsDirectory "node-v$nodeVersion-win-$architecture"
        $nodePath = Join-Path $nodeDirectory 'node.exe'
        if (-not (Test-Path -LiteralPath $nodePath)) {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $baseUrl = "https://nodejs.org/dist/v$nodeVersion"
            $archivePath = Join-Path $toolsDirectory $archiveName
            Write-Host "[setup] Downloading Node.js $nodeVersion ($architecture)..."
            Invoke-WebRequest "$baseUrl/$archiveName" -UseBasicParsing -OutFile $archivePath
            $checksumText = (Invoke-WebRequest "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content
            $checksumLine = @($checksumText -split "`n" | Where-Object { $_.Trim() -match ('^[a-fA-F0-9]{64}\s+' + [regex]::Escape($archiveName) + '$') })
            if ($checksumLine.Count -ne 1) { throw 'Node.js archive checksum was not found.' }
            $expectedHash = ($checksumLine[0].Trim() -split '\s+')[0]
            if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) {
                throw 'Node.js archive checksum does not match. The archive was not extracted.'
            }
            Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsDirectory -Force
            Remove-Item -LiteralPath $archivePath -Force
        }
        $pnpmDirectory = Join-Path $toolsDirectory 'pnpm'
        $pnpmPath = Join-Path $pnpmDirectory 'pnpm.cmd'
        $env:Path = "$nodeDirectory;$pnpmDirectory;$env:Path"
        if ((& $nodePath --version) -ne "v$nodeVersion") { throw 'The local Node.js version does not match .node-version.' }
        $installedPnpm = ''
        if (Test-Path -LiteralPath $pnpmPath) { $installedPnpm = & $pnpmPath --version }
        if ($installedPnpm -ne $pnpmVersion) {
            Write-Host "[setup] Installing pnpm $pnpmVersion in .tools..."
            & $nodePath (Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js') install --global --prefix $pnpmDirectory "pnpm@$pnpmVersion" --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned pnpm version.' }
        }
        Write-Host '[setup] Installing frontend dependencies from pnpm-lock.yaml...'
        & $pnpmPath --dir $frontend install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Could not install frontend dependencies.' }
        Write-Host '[setup] Ready. Run start.cmd --frontend (or start.cmd for both services).'
        Write-Host '[setup] Tools are stored in .tools; the user/system PATH was not changed.'
    } finally { if ($null -ne $setupLock) { $setupLock.Dispose() } }
} catch {
    Write-Host "[setup] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
