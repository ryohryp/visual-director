[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'status', 'logs', 'stop', 'restart')]
  [string]$Action = 'status',

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [ValidatePattern('^[A-Za-z0-9.:-]+$')]
  [string]$BindAddress = '127.0.0.1',

  [string]$BottomOfThirstRepoPath = $env:BOTTOM_OF_THIRST_REPO_PATH,

  [switch]$Tail,

  [ValidateRange(1, 1000)]
  [int]$Lines = 40
)

$ErrorActionPreference = 'Stop'

$scriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptsRoot
$stateRoot = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'VisualDirector'
} else {
  Join-Path $env:TEMP 'VisualDirector'
}
$statePath = Join-Path $stateRoot "visual-director-$Port.json"
$logPath = Join-Path $stateRoot "visual-director-$Port.log"
$runnerPath = Join-Path $stateRoot "visual-director-$Port.cmd"

function Ensure-StateRoot {
  try {
    New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
    $probePath = Join-Path $stateRoot ".write-test-$([guid]::NewGuid().ToString('N'))"
    [IO.File]::WriteAllText($probePath, 'ok')
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    return
  } catch {
    $fallbackRoot = Join-Path $env:TEMP 'VisualDirector'
    $script:stateRoot = $fallbackRoot
    $script:statePath = Join-Path $fallbackRoot "visual-director-$Port.json"
    $script:logPath = Join-Path $fallbackRoot "visual-director-$Port.log"
    $script:runnerPath = Join-Path $fallbackRoot "visual-director-$Port.cmd"
    New-Item -ItemType Directory -Force -Path $fallbackRoot | Out-Null
  }
}

function Read-State {
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  } catch {
    Write-Warning "Cannot read state file: $statePath"
    return $null
  }
}

function Save-State([object]$State) {
  Ensure-StateRoot
  $State | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
}

function Get-ProcessRecord([int]$ProcessId) {
  if ($ProcessId -le 0) {
    return $null
  }
  try {
    return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-PortOwner {
  try {
    $connection = Get-NetTCPConnection -LocalAddress $BindAddress -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    if ($connection) {
      return $connection
    }
  } catch {
    # Fall back to netstat when the NetTCPIP module is unavailable or restricted.
  }

  $address = [regex]::Escape($BindAddress)
  $line = netstat -ano -p tcp 2>$null |
    Select-String -Pattern "^\s*TCP\s+$address`:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" |
    Select-Object -First 1
  if ($line -and $line.Matches.Count -gt 0) {
    return [pscustomobject]@{ OwningProcess = [int]$line.Matches[0].Groups[1].Value }
  }
  return $null
}

function Get-CommandLine([object]$ProcessRecord) {
  if ($null -eq $ProcessRecord) {
    return ''
  }
  return [string]$ProcessRecord.CommandLine
}

function Test-ManagedProcess([object]$ProcessRecord) {
  $commandLine = Get-CommandLine $ProcessRecord
  if (-not $commandLine) {
    return $false
  }

  $repoMarker = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\')
  return (
    $commandLine.IndexOf($repoMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine -match 'src[\\/]index\.ts' -and
    $commandLine -match "--port\s+$Port(?:\s|$)"
  )
}

function Test-ManagedPortOwner([object]$Owner, [object]$State) {
  if ($null -eq $Owner) {
    return $false
  }
  if ($State -and $State.port -eq $Port -and $State.bindAddress -eq $BindAddress -and
      [int]$State.portPid -eq [int]$Owner.OwningProcess) {
    return $true
  }
  return Test-ManagedProcess (Get-ProcessRecord ([int]$Owner.OwningProcess))
}

function Test-ReadyLog {
  if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
    return $false
  }
  $recent = (Get-Content -LiteralPath $logPath -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
  return $recent -match 'Visual Director MCP listening'
}

function Show-ProcessOwner([object]$Owner, [string]$Label) {
  if ($null -eq $Owner) {
    Write-Output "${Label}: none"
    return
  }
  $processId = [int]$Owner.OwningProcess
  $record = Get-ProcessRecord $processId
  Write-Output "${Label}: PID=$processId"
  Write-Output "  $((Get-CommandLine $record).Trim())"
}

function Resolve-NodePath {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($nodeCommand -and $nodeCommand.Path) {
    return $nodeCommand.Path
  }

  $fnmRoot = if ($env:APPDATA) {
    Join-Path $env:APPDATA 'fnm\node-versions'
  } else {
    $null
  }
  if ($fnmRoot -and (Test-Path -LiteralPath $fnmRoot -PathType Container)) {
    $node = Get-ChildItem -LiteralPath $fnmRoot -Filter node.exe -Recurse -File -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($node) {
      return $node.FullName
    }
  }

  throw 'node.exe was not found. Add fnm or Node.js to PATH.'
}

function Write-Runner([string]$NodePath, [string]$ProjectPath, [string]$TsxPath) {
  $quote = [string][char]34
  if ($ProjectPath.Contains($quote) -or $NodePath.Contains($quote) -or $TsxPath.Contains($quote)) {
    throw 'A path contains a double quote and cannot be started safely.'
  }

  Ensure-StateRoot
  $runnerLines = @(
    '@echo off'
    "set `"BOTTOM_OF_THIRST_REPO_PATH=$ProjectPath`""
    "cd /d `"$repoRoot`""
    "`"$NodePath`" `"$TsxPath`" src/index.ts --http --host $BindAddress --port $Port >> `"$logPath`" 2>&1"
  )
  Set-Content -LiteralPath $runnerPath -Value ($runnerLines -join [Environment]::NewLine) -Encoding ascii
}

function Start-DetachedRunner([string]$CommandLine, [string]$WorkingDirectory) {
  if (-not ('VisualDirectorNativeMethods' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public class VisualDirectorStartupInfo
{
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX;
    public int dwY;
    public int dwXSize;
    public int dwYSize;
    public int dwXCountChars;
    public int dwYCountChars;
    public int dwFillAttribute;
    public int dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
}

[StructLayout(LayoutKind.Sequential)]
public struct VisualDirectorProcessInformation
{
    public IntPtr hProcess;
    public IntPtr hThread;
    public int dwProcessId;
    public int dwThreadId;
}

public static class VisualDirectorNativeMethods
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        VisualDirectorStartupInfo startupInfo,
        out VisualDirectorProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@
  }

  $startupInfo = New-Object VisualDirectorStartupInfo
  $startupInfo.cb = [Runtime.InteropServices.Marshal]::SizeOf($startupInfo)
  $processInfo = New-Object VisualDirectorProcessInformation
  $commandBuilder = New-Object Text.StringBuilder($CommandLine)
  $creationFlags = [uint32](0x00000008 -bor 0x00000400 -bor 0x08000000)
  $created = [VisualDirectorNativeMethods]::CreateProcess(
    $env:ComSpec,
    $commandBuilder,
    [IntPtr]::Zero,
    [IntPtr]::Zero,
    $false,
    $creationFlags,
    [IntPtr]::Zero,
    $WorkingDirectory,
    $startupInfo,
    [ref]$processInfo
  )
  if (-not $created) {
    $win32Error = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "Could not create a detached process: $([ComponentModel.Win32Exception]::new($win32Error).Message)"
  }
  [void][VisualDirectorNativeMethods]::CloseHandle($processInfo.hThread)
  [void][VisualDirectorNativeMethods]::CloseHandle($processInfo.hProcess)
  return $processInfo.dwProcessId
}

function Start-Server {
  $state = Read-State
  $owner = Get-PortOwner
  if ($owner) {
    if (Test-ManagedPortOwner $owner $state) {
      Write-Output "[RUNNING] Visual Director is already running. PID=$($owner.OwningProcess)"
      Write-Output "MCP: http://$BindAddress`:$Port/mcp"
      Write-Output "LOG: $logPath"
      return
    }
    Show-ProcessOwner $owner '[CONFLICT] Port is already in use'
    throw "Port $Port is already in use by another process. Inspect it or choose another port."
  }

  if (-not $BottomOfThirstRepoPath) {
    throw 'BOTTOM_OF_THIRST_REPO_PATH is not set. Pass -BottomOfThirstRepoPath.'
  }
  if (-not (Test-Path -LiteralPath $BottomOfThirstRepoPath -PathType Container)) {
    throw "Project repository was not found: $BottomOfThirstRepoPath"
  }

  $projectPath = [IO.Path]::GetFullPath($BottomOfThirstRepoPath)
  $tsxPath = Join-Path $repoRoot 'node_modules\tsx\dist\cli.mjs'
  if (-not (Test-Path -LiteralPath $tsxPath -PathType Leaf)) {
    throw "tsx was not found. Run npm.cmd install first: $tsxPath"
  }
  $nodePath = Resolve-NodePath

  Ensure-StateRoot
  Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
  Write-Runner $nodePath $projectPath $tsxPath

  $launcherPid = Start-DetachedRunner "`"$env:ComSpec`" /d /c `"$runnerPath`"" $repoRoot

  $deadline = (Get-Date).AddSeconds(8)
  $owner = $null
  do {
    Start-Sleep -Milliseconds 250
    $owner = Get-PortOwner
    if ($owner) {
      $record = Get-ProcessRecord ([int]$owner.OwningProcess)
      if ((Test-ManagedProcess $record) -or (Test-ReadyLog)) {
        break
      }
    }
  } while ((Get-Date) -lt $deadline)

  if (-not $owner) {
    $recentLog = if (Test-Path -LiteralPath $logPath) {
      (Get-Content -LiteralPath $logPath -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
    } else {
      '(no log)'
    }
    throw "Visual Director did not start. $recentLog"
  }

  $state = [ordered]@{
    name = 'visual-director'
    repoRoot = $repoRoot
    projectPath = $projectPath
    bindAddress = $BindAddress
    port = $Port
    portPid = [int]$owner.OwningProcess
    nodePath = $nodePath
    runnerPath = $runnerPath
    logPath = $logPath
    startedAt = (Get-Date).ToString('o')
  }
  Save-State $state

  Write-Output "[STARTED] Visual Director PID=$($owner.OwningProcess)"
  Write-Output "MCP: http://$BindAddress`:$Port/mcp"
  Write-Output "LOG: $logPath"
}

function Show-Status {
  $state = Read-State
  $owner = Get-PortOwner
  if ($owner) {
    if (Test-ManagedPortOwner $owner $state) {
      Write-Output '[RUNNING] Visual Director'
      Write-Output "PID: $($owner.OwningProcess)"
      Write-Output "MCP: http://$BindAddress`:$Port/mcp"
      Write-Output "LOG: $logPath"
      return
    }
      Show-ProcessOwner $owner '[CONFLICT] Unmanaged process is using the port'
    return
  }

  if ($state) {
    Write-Output "[STOPPED] A stale state file remains: $statePath"
    Write-Output "Previous PID: $($state.portPid)"
    return
  }
  Write-Output '[STOPPED] Visual Director is not running.'
}

function Get-ProcessTree([int]$RootProcessId) {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$ids.Add($RootProcessId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) {
        $changed = $true
      }
    }
  }
  return @($ids)
}

function Stop-Server {
  $state = Read-State
  $owner = Get-PortOwner
  $stopped = New-Object System.Collections.Generic.List[int]

  if ($owner) {
    $ownerPid = [int]$owner.OwningProcess
    $ownerRecord = Get-ProcessRecord $ownerPid
    if (-not (Test-ManagedPortOwner $owner $state) -and -not (Test-ManagedProcess $ownerRecord)) {
      Show-ProcessOwner $owner '[NOT STOPPED] Unmanaged process'
      throw 'For safety, unmanaged processes are not stopped.'
    }
    foreach ($processId in (Get-ProcessTree $ownerPid | Sort-Object -Descending)) {
      $record = Get-ProcessRecord ([int]$processId)
      if ((Test-ManagedProcess $record) -or [int]$processId -eq $ownerPid) {
        Stop-Process -Id ([int]$processId) -Force -ErrorAction SilentlyContinue
        [void]$stopped.Add([int]$processId)
      }
    }
  }

  if ($state -and $state.runnerPath) {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    foreach ($process in $all) {
      if ((Get-CommandLine $process).IndexOf([string]$state.runnerPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        [void]$stopped.Add([int]$process.ProcessId)
      }
    }
  }

  if ($stopped.Count -gt 0) {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    Write-Output "[STOPPED] PID=$(([int[]]$stopped | Sort-Object -Unique) -join ', ')"
  } elseif ($state) {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    Write-Output '[STOPPED] No running process. Removed the stale state file.'
  } else {
    Write-Output '[STOPPED] Visual Director is not running.'
  }
}

function Show-Logs {
  $state = Read-State
  $path = if ($state -and $state.logPath) { $state.logPath } else { $logPath }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Log file was not found: $path"
  }
  Get-Content -LiteralPath $path -Tail $Lines -Wait:$Tail
}

try {
  Ensure-StateRoot
  switch ($Action) {
    'start' { Start-Server }
    'status' { Show-Status }
    'logs' { Show-Logs }
    'stop' { Stop-Server }
    'restart' {
      Stop-Server
      Start-Server
    }
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
