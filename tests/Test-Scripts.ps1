param([switch]$SmokeLifecycle)
$ErrorActionPreference = 'Stop'
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach ($file in Get-ChildItem -LiteralPath $packageRoot -Filter '*.ps1' -File) {
    $tokens = $null; $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ('PowerShell parse failed: ' + $file.Name) }
    if (@([System.IO.File]::ReadAllBytes($file.FullName) | Where-Object { $_ -gt 127 }).Count) { throw ('Non-ASCII PowerShell may break Windows PowerShell 5.1: ' + $file.Name) }
}
foreach ($file in Get-ChildItem -LiteralPath $packageRoot -Filter '*.cmd' -File) {
    if (@([System.IO.File]::ReadAllBytes($file.FullName) | Where-Object { $_ -gt 127 }).Count) { throw ('Non-ASCII CMD wrapper: ' + $file.Name) }
}
Write-Host 'PASS: PowerShell parser and ASCII compatibility checks.'
if (-not $SmokeLifecycle) { return }

. (Join-Path $packageRoot 'Board.Common.ps1')
$python = Get-BoardPython
$boardTestRoot = [System.IO.Path]::GetFullPath((Join-Path $packageRoot 'test-results'))
New-Item -ItemType Directory -Path $boardTestRoot -Force | Out-Null
$stage = [System.IO.Path]::GetFullPath((Join-Path $boardTestRoot ('board lifecycle ' + [guid]::NewGuid().ToString('N'))))
if (-not $stage.StartsWith($boardTestRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test target.' }
New-Item -ItemType Directory -Path $stage | Out-Null
$foreign = $null; $firstRecord = $null
function Get-TestPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    return $port
}
try {
    Get-ChildItem -LiteralPath $packageRoot -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stage }
    Copy-Item -LiteralPath (Join-Path $packageRoot 'web') -Destination (Join-Path $stage 'web') -Recurse
    $port = Get-TestPort
    & (Join-Path $stage 'Start-Board.ps1') -Port $port -NoBrowser
    $recordFile = Join-Path $stage '.runtime\server.json'
    $firstRaw = Get-Content -LiteralPath $recordFile -Raw -Encoding UTF8
    $firstRecord = $firstRaw | ConvertFrom-Json
    & (Join-Path $stage 'Start-Board.ps1') -Port $port -NoBrowser
    $second = Get-Content -LiteralPath $recordFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($firstRecord.pid -ne $second.pid) { throw 'Repeated Start created a duplicate process.' }
    $state = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/state.json') -TimeoutSec 2
    if (-not $state.demo -or $state.projects.Count -ne 2) { throw 'Unexpected demo served.' }

    $foreignPort = Get-TestPort
    $foreign = Start-Process -FilePath $python -ArgumentList ('-m http.server ' + $foreignPort + ' --bind 127.0.0.1') -WorkingDirectory $stage -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stage 'foreign.log') -RedirectStandardError (Join-Path $stage 'foreign-error.log')
    for ($i=0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 100
        if (@(Get-NetTCPConnection -LocalPort $foreignPort -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $foreign.Id }).Count) { break }
    }
    if ($foreign.HasExited) { throw 'Foreign test fixture exited.' }
    $forged = $firstRaw | ConvertFrom-Json; $forged.pid = $foreign.Id
    [System.IO.File]::WriteAllText($recordFile, ($forged | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    $refused = $false
    try { & (Join-Path $stage 'Stop-Board.ps1') } catch { $refused = $true }
    if (-not $refused -or $foreign.HasExited) { throw 'A forged PID record was not safely rejected.' }
    [System.IO.File]::WriteAllText($recordFile, $firstRaw, (New-Object System.Text.UTF8Encoding($false)))
    & (Join-Path $stage 'Stop-Board.ps1')
    if (Get-Process -Id $firstRecord.pid -ErrorAction SilentlyContinue) { throw 'Owned board did not stop.' }
    $firstRecord = $null
    $refused = $false
    try { & (Join-Path $stage 'Start-Board.ps1') -Port $foreignPort -NoBrowser } catch { $refused = $true }
    if (-not $refused -or $foreign.HasExited) { throw 'Foreign port collision was not safely rejected.' }
    if (Test-Path -LiteralPath $recordFile) { throw 'Foreign service was mistaken for an owned healthy board.' }
    Write-Host 'PASS: paths with spaces, Start reuse, real GET, forged-PID refusal, owned Stop, and foreign-port collision refusal.'
} finally {
    if ($firstRecord) {
        try { & (Join-Path $stage 'Stop-Board.ps1') } catch { }
    }
    if (Test-Path -LiteralPath (Join-Path $stage '.runtime\server.json')) {
        try { & (Join-Path $stage 'Stop-Board.ps1') } catch { }
    }
    if ($foreign -and -not $foreign.HasExited) { $foreign.Kill(); $foreign.WaitForExit(3000) | Out-Null }
    $resolvedStage = [System.IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($boardTestRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe recursive cleanup target.' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
