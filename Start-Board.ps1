param([ValidateRange(1024,65535)][int]$Port = 8787, [switch]$NoBrowser)
. (Join-Path $PSScriptRoot 'Board.Common.ps1')
$boardRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$runtime = Join-Path $boardRoot '.runtime'
$recordPath = Join-Path $runtime 'server.json'
$mutex = Enter-BoardMutex $boardRoot
$started = $null
try {
    if (Test-Path -LiteralPath $recordPath) {
        $record = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $existing = Get-OwnedBoardProcess $boardRoot $record
        if ($existing) {
            if ([int]$record.port -ne $Port) { throw 'This folder already runs on a different port. Use Stop-Board first.' }
            Write-Host ('Board already running: http://127.0.0.1:' + $Port)
            if (-not $NoBrowser) { Start-Process ('http://127.0.0.1:' + $Port) }
            return
        }
        Remove-Item -LiteralPath $recordPath
    }
    $python = Get-BoardPython
    & $python (Join-Path $boardRoot 'update_state.py') init
    if ($LASTEXITCODE -ne 0) { throw 'Checkpoint initialization failed; existing files were preserved.' }
    & $python (Join-Path $boardRoot 'server.py') --check
    if ($LASTEXITCODE -ne 0) { throw 'Checkpoint validation failed; no server started.' }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $arguments = Get-BoardArguments $boardRoot $Port
    $started = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $boardRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 150
        if ($started.HasExited) { throw 'The board could not start. The port may be occupied; inspect the local .runtime log.' }
        try {
            $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq $started.Id })
            if ($listeners.Count -eq 0) { continue }
            $response = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/config.json') -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) { throw 'The board did not become ready.' }
    Start-Sleep -Milliseconds 150
    if ($started.HasExited) { throw 'The new process exited; an existing service may already own the port.' }
    $cim = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $started.Id)
    $record = [pscustomobject]@{version=1;pid=$started.Id;port=$Port;executable=[string]$cim.ExecutablePath;script=(Join-Path $boardRoot 'server.py');start_ticks=[string]$cim.CreationDate.ToUniversalTime().Ticks}
    $verified = Get-OwnedBoardProcess $boardRoot $record
    if (-not $verified) { throw 'The new server process could not be verified.' }
    $temporary = Join-Path $runtime ('server-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [System.IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $recordPath -Force
    $started = $null
    Write-Host ('Checkpoint board ready: http://127.0.0.1:' + $Port)
    if (-not $NoBrowser) { Start-Process ('http://127.0.0.1:' + $Port) }
} catch {
    if ($started -and -not $started.HasExited) { $started.Kill(); $started.WaitForExit(3000) | Out-Null }
    throw
} finally { Exit-BoardMutex $mutex }
