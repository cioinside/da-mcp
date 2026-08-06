#Requires -Version 5.1
<#
.SYNOPSIS
  Install or uninstall the da-mcp Windows Service (SCM-registered).

.DESCRIPTION
  Wrapper invoked by `node dist/server-dispatch.js install-service` /
  `uninstall-service`. Reads node path, project root, transport, and
  log path from environment variables (set by install-service.ts to
  dodge the cmd-line path-quoting minefield on Windows).

  Runs under elevated context — `New-Service` / `sc.exe create` need
  Administrator rights.

.PARAMETER Action
  Install   — register and start the da-mcp service.
  Uninstall — stop and remove the registration.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File da-mcp-service.ps1 -Action Install
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Install', 'Uninstall')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'

$ServiceName  = 'da-mcp'
$DisplayName  = 'da-mcp cross-platform desktop automation MCP server'
$Description  = 'MCP server exposing screenshot, OCR, mouse/keyboard, and window control to AI agents.'
$NodePath     = $env:DA_MCP_NODE_PATH
$ProjectRoot  = $env:DA_MCP_PROJECT_ROOT
$Transport    = $env:DA_MCP_TRANSPORT_VALUE
$LogPath      = $env:DA_MCP_LOG_PATH

if (-not $NodePath)    { throw 'DA_MCP_NODE_PATH env var is required (set by install-service.ts)' }
if (-not $ProjectRoot) { throw 'DA_MCP_PROJECT_ROOT env var is required (set by install-service.ts)' }
if (-not $Transport)   { $Transport = 'http' }
if (-not $LogPath)     { $LogPath = "$env:ProgramData\da-mcp\daemon.log" }

$Exec = "`"$NodePath`" `"$ProjectRoot\dist\server-dispatch.js`""

function Test-ServicePresent {
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  return [bool]$existing
}

function Stop-And-Remove {
  $present = Test-ServicePresent
  if ($present) {
    Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & sc.exe delete $ServiceName | Out-Null
  }
}

switch ($Action) {
  'Install' {
    Stop-And-Remove
    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    # binPath needs cmd.exe wrapping because the quoted exe path + args
    # pattern trips SCM's parser when passed directly.
    $binPath = "cmd.exe /c $Exec"

    New-Service -Name $ServiceName `
                -BinaryPathName $binPath `
                -DisplayName $DisplayName `
                -Description $Description `
                -StartupType Automatic | Out-Null

    & sc.exe failure $ServiceName reset= 30 actions= restart/5000/restart/10000/restart/30000 | Out-Null

    Start-Service -Name $ServiceName
    Write-Output "da-mcp service installed and started."
  }
  'Uninstall' {
    Stop-And-Remove
    Write-Output "da-mcp service removed."
  }
}