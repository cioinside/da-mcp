<#
.SYNOPSIS
    Uninstalls da-mcp from Windows.

.DESCRIPTION
    Removes the da-mcp install directory and optionally:
      - Removes the da-mcp entry from known MCP client config files
        (Claude Desktop, OpenCode, Cursor)
      - Removes tesseract, Node.js, VS Build Tools (DANGEROUS — affects whole system)

    Defaults to a safe uninstall (only the project files).

.PARAMETER InstallDir
    Where da-mcp is installed. Default: $env:LOCALAPPDATA\da-mcp

.PARAMETER RemoveMcpConfig
    Remove da-mcp entry from known MCP client config files.
    Affects: Claude Desktop, OpenCode, Cursor.
    Pass -McpConfigPath to add custom paths.

.PARAMETER RemoveSystemDeps
    Also uninstall tesseract, Node.js, and VS Build Tools.
    DANGEROUS — these are system-wide. Use with care.

.PARAMETER McpConfigPath
    Additional MCP client config files to clean (Array of paths).

.EXAMPLE
    .\uninstall-windows.ps1

.EXAMPLE
    # Remove project + clean MCP client configs
    .\uninstall-windows.ps1 -RemoveMcpConfig

.EXAMPLE
    # Full nuke (project + MCP configs + system deps)
    .\uninstall-windows.ps1 -RemoveMcpConfig -RemoveSystemDeps

.EXAMPLE
    # Custom install dir
    .\uninstall-windows.ps1 -InstallDir "C:\Tools\da-mcp"
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'da-mcp'),
    [switch]$RemoveMcpConfig,
    [switch]$RemoveSystemDeps,
    [string[]]$McpConfigPath = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Banner  { param($msg) Write-Host ''; Write-Host "  $msg" -ForegroundColor Magenta; Write-Host "  $(('─' * $msg.Length))" -ForegroundColor DarkGray }
function Write-Success { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Info    { param($msg) Write-Host "  → $msg" -ForegroundColor Cyan }
function Write-Warn    { param($msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }

Write-Banner 'da-mcp uninstaller for Windows'

# ─── Step 1: Confirm if system-wide removal is requested ─────────────────────
if ($RemoveSystemDeps) {
    Write-Warn 'You requested -RemoveSystemDeps. This will UNINSTALL:'
    Write-Warn '  - tesseract (UB-Mannheim.TesseractOCR)'
    Write-Warn '  - Node.js (OpenJS.NodeJS.LTS)'
    Write-Warn '  - VS Build Tools (Microsoft.VisualStudio.2022.BuildTools)'
    Write-Warn 'These are NOT da-mcp-specific — other apps may break.'
    $confirm = Read-Host '  Type "yes" to proceed'
    if ($confirm -ne 'yes') {
        Write-Info 'Aborted.'
        exit 0
    }
}

# ─── Step 2: Remove install dir ──────────────────────────────────────────────
Write-Info "Removing install dir: $InstallDir"
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Success "Removed $InstallDir"
} else {
    Write-Warn "$InstallDir not found (already gone?)"
}

# ─── Step 3: Clean MCP client configs ────────────────────────────────────────
if ($RemoveMcpConfig) {
    Write-Info 'Cleaning MCP client configs...'

    $defaultPaths = @()

    # Claude Desktop
    if ($env:APPDATA) {
        $defaultPaths += Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
    }
    # OpenCode
    if ($env:APPDATA) {
        $defaultPaths += Join-Path $env:APPDATA 'opencode\config.json'
    }
    # Cursor
    if ($env:USERPROFILE) {
        $defaultPaths += Join-Path $env:USERPROFILE '.cursor\mcp.json'
    }

    $allPaths = @($defaultPaths + $McpConfigPath) | Select-Object -Unique

    foreach ($cfg in $allPaths) {
        if (-not (Test-Path $cfg)) {
            Write-Info "  not found: $cfg"
            continue
        }
        try {
            $content = Get-Content -Path $cfg -Raw -Encoding UTF8
            $json = $content | ConvertFrom-Json -ErrorAction Stop
            if ($json.mcpServers.'da-mcp') {
                $json.mcpServers.PSObject.Properties.Remove('da-mcp')
                $json | ConvertTo-Json -Depth 10 | Set-Content -Path $cfg -Encoding UTF8
                Write-Success "  cleaned: $cfg"
            } else {
                Write-Info "  no da-mcp entry: $cfg"
            }
        } catch {
            Write-Warn "  failed to clean $cfg — $_"
        }
    }
}

# ─── Step 4: Remove system deps (if requested) ───────────────────────────────
if ($RemoveSystemDeps) {
    Write-Info 'Uninstalling system deps...'

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        @('UB-Mannheim.TesseractOCR', 'OpenJS.NodeJS.LTS', 'Microsoft.VisualStudio.2022.BuildTools') | ForEach-Object {
            Write-Info "  winget uninstall --id $_"
            winget uninstall --id $_ --silent --accept-source-agreements 2>&1 | Out-Null
        }
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        @('tesseract', 'nodejs-lts', 'visualstudio2022buildtools') | ForEach-Object {
            Write-Info "  choco uninstall $_ -y"
            choco uninstall $_ -y --no-progress 2>&1 | Out-Null
        }
    }
    Write-Success 'System deps removed'
}

# ─── Done ────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║              da-mcp uninstalled                            ║' -ForegroundColor Green
Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  Restart your MCP client to pick up the changes.' -ForegroundColor Cyan
Write-Host ''
