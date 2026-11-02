param([switch]$OpenAfterInstall)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AgentView.Common.ps1')
$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$codex = Get-Command codex.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $codex) { $codex = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue }
if (-not $node -or -not $npm) { throw 'Node.js 18+ and npm are required. Install Node.js, reopen your terminal, then run this script again.' }
if (-not $codex) { throw 'The Codex CLI is required. Install/configure Codex yourself; this installer does not install or update Codex.' }
$versionText = [string](& $node.Source --version)
if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(\d+)\.') { throw 'Cannot determine Node.js version.' }
if ([int]$Matches[1] -lt 18) { throw 'Node.js 18+ is required. This script does not update Node.js.' }

$codexConfigRoot = [Environment]::GetEnvironmentVariable('CODEX_HOME')
if (-not $codexConfigRoot) { $codexConfigRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
$configPath = Join-Path $codexConfigRoot 'config.toml'
if (Test-Path -LiteralPath $configPath) {
    $privateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexLocalBoard\private-config-backups'
    New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
    $backupName = 'codex-config-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.toml'
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $privateRoot $backupName)
    Write-Host 'Existing Codex config backed up privately in LocalAppData; do not publish that backup.'
}

$null = & $npm.Source install --global --ignore-scripts codex-agent-view@0.5.6 2>$null
if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Inspect npm diagnostics privately; no Codex upgrade was requested.' }
$cli = Get-AgentViewCli
$null = & $cli install 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Official plugin registration failed. Existing private config backup is available.' }
$doctorText = & $cli doctor --json 2>$null
$doctorExit = $LASTEXITCODE
try { $doctor = ($doctorText -join "`n") | ConvertFrom-Json } catch { throw 'The official doctor returned invalid JSON; no trust settings were changed.' }
$safe = [ordered]@{
    codex_ok=[bool]$doctor.codex.ok
    installed=[bool]$doctor.plugin.installed
    enabled=[bool]$doctor.plugin.enabled
    plugin_version=[string]$doctor.plugin.version
    hooks_wired=[bool]$doctor.hook.wiring_ok
    declared_hook_count=@($doctor.hook.declared_events).Count
    native_trust=[string]$doctor.hook.trust
    monitor_ok=[bool]$doctor.monitor.ok
    events_received=[bool]$doctor.monitor.events_received
    observed_sessions=$doctor.monitor.sessions
}
$safe | ConvertTo-Json | Write-Host
if ($doctorExit -ne 0) { throw 'Official doctor reported an issue. Review its bounded diagnostic codes privately.' }
Write-Host 'Review Plugins/Hooks in Codex and complete native Trust when prompted. This script does not modify trust, restart Codex, or update Codex.'
Write-Host 'After native loading/trust, new task events register automatically. Earlier conversations are not reconstructed.'
. (Join-Path $PSScriptRoot 'Board.Common.ps1')
try {
    $python = Get-BoardPython
} catch {
    $python = $null
    Write-Warning 'Agent View was installed. Python 3.10+ is needed only for the checkpoint board and optional Chinese UI addon; install Python and run agentview_zh_tw.py --apply later.'
}
if ($python) {
    $null = & $python (Join-Path $PSScriptRoot 'agentview_zh_tw.py') --apply 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Agent View installation remains valid; the optional 0.5.6 Chinese UI addon needs manual review. Run agentview_zh_tw.py without --apply for its safe report.' }
    else { Write-Host 'Version-checked Traditional Chinese public UI addon applied or already current; hooks and authentication were not changed.' }
}
if ($OpenAfterInstall) { & (Join-Path $PSScriptRoot 'Open-All-Agents.ps1') }
