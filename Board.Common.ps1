$ErrorActionPreference = 'Stop'

function Convert-BoardCommandLine([string]$CommandLine) {
    if (-not ('CodexLocalBoard.NativeArguments' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodexLocalBoard {
    public static class NativeArguments {
        [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern IntPtr CommandLineToArgvW(string command, out int count);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
        public static string[] Parse(string command) {
            int count; IntPtr pointer=CommandLineToArgvW(command, out count);
            if(pointer==IntPtr.Zero) throw new InvalidOperationException("Cannot parse process command line");
            try {
                string[] arguments=new string[count];
                for(int i=0;i<count;i++) arguments[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer,i*IntPtr.Size));
                return arguments;
            } finally { LocalFree(pointer); }
        }
    }
}
'@
    }
    return [CodexLocalBoard.NativeArguments]::Parse($CommandLine)
}

function Get-BoardPython {
    foreach ($name in @('python.exe', 'python3.exe', 'py.exe')) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $command) { continue }
        $prefix = @()
        if ($name -eq 'py.exe') { $prefix = @('-3') }
        $raw = & $command.Source @prefix -c 'import json,sys; print(json.dumps(dict(executable=sys.executable,version=list(sys.version_info[:2]))))' 2>$null
        if ($LASTEXITCODE -ne 0) { continue }
        try { $facts = $raw | ConvertFrom-Json } catch { continue }
        if ($facts.version[0] -eq 3 -and $facts.version[1] -ge 10) { return [string]$facts.executable }
    }
    throw 'Python 3.10+ was not found. Install Python and enable its command-line launcher.'
}

function Enter-BoardMutex([string]$Root) {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $bytes = $hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant())) } finally { $hash.Dispose() }
    $key = ([System.BitConverter]::ToString($bytes)).Replace('-', '').Substring(0, 24)
    $mutex = New-Object System.Threading.Mutex($false, ('Local\CodexLocalBoard-' + $key))
    try { $locked = $mutex.WaitOne(5000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { $mutex.Dispose(); throw 'Another Start/Stop operation is busy.' }
    return $mutex
}

function Get-BoardArguments([string]$Root, [int]$Port) {
    $arguments = @((Join-Path $Root 'server.py'), '--port', [string]$Port, '--state', (Join-Path $Root 'state.json'), '--config', (Join-Path $Root 'config.json'))
    return (($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
}

function Get-OwnedBoardProcess([string]$Root, $Record) {
    if ($Record.version -ne 1 -or $Record.port -lt 1024 -or $Record.port -gt 65535 -or $Record.pid -le 0) { throw 'Invalid local runtime record; no process was stopped.' }
    $cim = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$Record.pid) -ErrorAction Stop
    if (-not $cim) { return $null }
    $script = [System.IO.Path]::GetFullPath((Join-Path $Root 'server.py'))
    $executable = [string]$cim.ExecutablePath
    $start = [string]$cim.CreationDate.ToUniversalTime().Ticks
    $command = [string]$cim.CommandLine
    $actualArguments = @(Convert-BoardCommandLine $command)
    $expectedArguments = @($executable, $script, '--port', [string]$Record.port, '--state', (Join-Path $Root 'state.json'), '--config', (Join-Path $Root 'config.json'))
    $commandMatches = $actualArguments.Count -eq $expectedArguments.Count
    if ($commandMatches) {
        for ($index = 0; $index -lt $expectedArguments.Count; $index++) {
            if ($index -in @(0,1,5,7)) { $commandMatches = $commandMatches -and $actualArguments[$index] -ieq $expectedArguments[$index] }
            else { $commandMatches = $commandMatches -and $actualArguments[$index] -ceq $expectedArguments[$index] }
        }
    }
    $isPython = [System.IO.Path]::GetFileName($executable) -match '^python(?:3(?:\.\d+)?)?\.exe$'
    if (-not $isPython -or $executable -ine [string]$Record.executable -or $script -ine [string]$Record.script -or $start -ne [string]$Record.start_ticks -or -not $commandMatches) {
        throw 'Runtime ownership check failed; no process was stopped. Inspect the local .runtime record.'
    }
    return (Get-Process -Id ([int]$Record.pid) -ErrorAction Stop)
}

function Exit-BoardMutex($Mutex) {
    if ($Mutex) { $Mutex.ReleaseMutex(); $Mutex.Dispose() }
}
