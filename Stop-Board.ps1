. (Join-Path $PSScriptRoot 'Board.Common.ps1')
$boardRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$recordPath = Join-Path $boardRoot '.runtime\server.json'
$mutex = Enter-BoardMutex $boardRoot
try {
    if (-not (Test-Path -LiteralPath $recordPath)) { Write-Host 'No server record for this folder.'; return }
    $record = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $owned = Get-OwnedBoardProcess $boardRoot $record
    if ($owned) {
        $owned.Kill()
        if (-not $owned.WaitForExit(5000)) { throw 'The verified board process did not exit; runtime record retained.' }
        Write-Host 'This folder''s checkpoint board stopped. Checkpoint files were retained.'
    } else { Write-Host 'The recorded server already exited.' }
    Remove-Item -LiteralPath $recordPath
} finally { Exit-BoardMutex $mutex }
