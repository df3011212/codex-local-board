$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AgentView.Common.ps1')
$cli = Get-AgentViewCli
$previousThread = [Environment]::GetEnvironmentVariable('CODEX_THREAD_ID', 'Process')
try {
    [Environment]::SetEnvironmentVariable('CODEX_THREAD_ID', $null, 'Process')
    $ErrorActionPreference = 'Continue'
    $output = (& $cli open 2>&1 | Out-String)
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0) {
        $bounded = [regex]::Match($output, '\b[A-Z][A-Z0-9_]{3,80}\b').Value
        throw ('Agent View did not open. Exit code: ' + $code + '. Diagnostic: ' + $bounded)
    }
    Write-Host 'Agent View opened in the default browser. No private viewer URL was printed.'
} finally {
    [Environment]::SetEnvironmentVariable('CODEX_THREAD_ID', $previousThread, 'Process')
}
