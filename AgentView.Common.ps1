# Resolve the official npm shim; never accept a command or URL from task data.
function Get-AgentViewCli {
    $command = Get-Command codex-agent-view.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return [string]$command.Source }
    $npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($npm) {
        $prefix = @(& $npm.Source prefix --global 2>$null)
        if ($LASTEXITCODE -eq 0 -and $prefix.Count -eq 1 -and [System.IO.Path]::IsPathRooted([string]$prefix[0])) {
            $shim = Join-Path ([string]$prefix[0]) 'codex-agent-view.cmd'
            if (Test-Path -LiteralPath $shim -PathType Leaf) { return $shim }
        }
    }
    throw 'The official Agent View npm shim was not found. Check npm''s global prefix and installation.'
}
