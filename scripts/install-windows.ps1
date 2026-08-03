<#
.SYNOPSIS
    Installs da-mcp (desktop automation MCP server) on Windows.

.DESCRIPTION
    Full installer for the da-mcp MCP server on Windows 10+ (build 17763+)
    and Windows Server 2019+.

    Steps performed:
      1. Verifies PowerShell 5.1+ (or PowerShell 7+)
      2. Checks / installs Node.js 22+ via winget (or chocolatey)
      3. Checks / installs tesseract via winget (or chocolatey)
      4. Checks Visual Studio Build Tools (warns if missing — robotjs needs it)
      5. Downloads da-mcp source (git clone or ZIP)
      6. Runs npm install (compiles robotjs native binary)
      7. Runs npm run build
      8. Runs npm test (mock mode — skips native calls)
      9. Prints the path and MCP client config snippet

    Tested on: Windows 10 21H2, Windows 11 23H2, Windows Server 2022.
    PowerShell 5.1+ required (ships with Windows 10+).

.PARAMETER InstallDir
    Where to install da-mcp. Default: $env:LOCALAPPDATA\da-mcp

.PARAMETER Source
    Git URL to clone from. Default: https://github.com/cioinside/da-mcp.git

.PARAMETER Ref
    Git ref (branch / tag / commit) to check out. Default: main

.PARAMETER UseZip
    Download source as ZIP instead of git clone (no git required)

.PARAMETER SkipBuild
    Skip npm run build (defer to first run)

.PARAMETER SkipTest
    Skip npm test

.PARAMETER SkipSystemDeps
    Do not install system-level dependencies (Node / tesseract /
    VS Build Tools) — assume they are already present

.PARAMETER Force
    Overwrite existing install directory if present

.PARAMETER Prerelease
    Allow prerelease versions of Node.js (not recommended)

.EXAMPLE
    .\install-windows.ps1

.EXAMPLE
    .\install-windows.ps1 -InstallDir "C:\Tools\da-mcp" -UseZip

.EXAMPLE
    # CI / non-interactive mode
    .\install-windows.ps1 -SkipSystemDeps -SkipTest -Force

.NOTES
    Equivalent to: scripts/install-system-deps.sh + npm install + build + test
    on Linux, but for Windows. See ../GUIDE.md for the manual walkthrough.
#>
[CmdletBinding()]
param(
    [string]$InstallDir   = (Join-Path $env:LOCALAPPDATA 'da-mcp'),
    [string]$Source       = 'https://github.com/cioinside/da-mcp.git',
    [string]$Ref          = 'main',
    [switch]$UseZip,
    [switch]$SkipBuild,
    [switch]$SkipTest,
    [switch]$SkipSystemDeps,
    [switch]$Force,
    [switch]$Prerelease
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ─── Helpers ──────────────────────────────────────────────────────────────────
function Write-Banner  { param($msg) Write-Host ''; Write-Host "  $msg" -ForegroundColor Magenta; Write-Host "  $(('─' * $msg.Length))" -ForegroundColor DarkGray }
function Write-Success { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Info    { param($msg) Write-Host "  → $msg" -ForegroundColor Cyan }
function Write-Warn    { param($msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Step    { param($n, $total, $msg) Write-Host ''; Write-Host "[$n/$total] $msg" -ForegroundColor Magenta }

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Test-Winget {
    $x = Get-Command winget -ErrorAction SilentlyContinue
    return $null -ne $x
}

function Test-Choco {
    $x = Get-Command choco -ErrorAction SilentlyContinue
    return $null -ne $x
}

function Install-Package {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$PackageId,
        [string]$WingetExtraArgs = '',
        [string]$ChocoExtraArgs = ''
    )
    if (Test-Winget) {
        Write-Info "Installing $PackageId via winget..."
        $args = @('install', '--id', $PackageId, '--accept-package-agreements', '--accept-source-agreements', '--silent')
        if ($Prerelease) { $args += '--include-unknown' }
        if ($WingetExtraArgs) { $args += $WingetExtraArgs }
        & winget @args
    } elseif (Test-Choco) {
        Write-Info "Installing $PackageId via chocolatey..."
        $chocoArgs = @('install', $PackageId, '-y', '--no-progress')
        if ($ChocoExtraArgs) { $chocoArgs += $ChocoExtraArgs }
        & choco @chocoArgs
    } else {
        throw "Neither winget nor chocolatey found. Install Node.js 22+ manually: https://nodejs.org/"
    }
    Refresh-Path
}

# ─── Banner ──────────────────────────────────────────────────────────────────
Write-Banner 'da-mcp installer for Windows'

# ─── Step 1: PowerShell version ──────────────────────────────────────────────
Write-Step 1 7 'Checking PowerShell version...'
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Fail "PowerShell 5.0+ required (found $($PSVersionTable.PSVersion))"
    Write-Info 'Install PowerShell 7:  winget install Microsoft.PowerShell'
    exit 1
}
Write-Success "PowerShell $($PSVersionTable.PSVersion)"

# ─── Step 2: Node.js 22+ ─────────────────────────────────────────────────────
Write-Step 2 7 'Checking Node.js 22+...'
$needsNode = $false
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    $needsNode = $true
} else {
    $nodeVersion = (node --version) -replace 'v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 22) {
        Write-Warn "Node.js v$nodeVersion found (need 22+)"
        $needsNode = $true
    } else {
        Write-Success "Node.js v$nodeVersion"
    }
}

if ($needsNode) {
    if ($SkipSystemDeps) {
        Write-Fail "Node.js 22+ required but not installed. Run without -SkipSystemDeps."
        exit 1
    }
    try {
        Install-Package -PackageId 'OpenJS.NodeJS.LTS'
        $nodeVersion = (node --version) -replace 'v', ''
        Write-Success "Node.js v$nodeVersion installed"
    } catch {
        Write-Fail "Node.js install failed: $_"
        Write-Info 'Manual install: https://nodejs.org/en/download'
        exit 1
    }
}

# ─── Step 3: tesseract ───────────────────────────────────────────────────────
Write-Step 3 7 'Checking tesseract...'
$tesseractInstalled = $false
try {
    $tessOut = & tesseract --version 2>&1 | Select-Object -First 1
    if ($tessOut -match 'tesseract\s+v?(\d+)') {
        Write-Success "tesseract $($Matches[1])"
        $tesseractInstalled = $true
    }
} catch {}

if (-not $tesseractInstalled) {
    if ($SkipSystemDeps) {
        Write-Warn 'tesseract not found. da_ocr will use WASM fallback (slower).'
        Write-Info 'Install manually:  winget install --id UB-Mannheim.TesseractOCR'
    } else {
        try {
            Install-Package -PackageId 'UB-Mannheim.TesseractOCR'
            Write-Success 'tesseract installed'
        } catch {
            Write-Warn "tesseract install failed (continuing): $_"
            Write-Info 'da_ocr will use WASM fallback. To install later: winget install --id UB-Mannheim.TesseractOCR'
        }
    }
}

# ─── Step 4: VS Build Tools (for robotjs) ────────────────────────────────────
Write-Step 4 7 'Checking Visual Studio Build Tools (required for robotjs)...'
$vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsOk = $false
if (Test-Path $vsWhere) {
    $vsInstall = & $vsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName 2>$null
    if ($vsInstall) {
        Write-Success "VS Build Tools: $vsInstall"
        $vsOk = $true
    } else {
        Write-Warn 'VS Build Tools installed but C++ workload missing.'
    }
}
if (-not $vsOk) {
    Write-Warn 'Visual Studio Build Tools (C++ workload) not detected — robotjs may fail to build.'
    if (-not $SkipSystemDeps) {
        if ($env:CI -eq 'true') {
            Write-Info 'CI mode: skipping interactive VS install. Run this on a developer machine first:'
            Write-Info '  winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --quiet --wait" --accept-package-agreements --accept-source-agreements'
        } else {
            $choice = Read-Host '  Install VS Build Tools now? (~5GB, takes 10+ min) [y/N]'
            if ($choice -eq 'y') {
                try {
                    Install-Package -PackageId 'Microsoft.VisualStudio.2022.BuildTools' `
                        -WingetExtraArgs '--override "--add Microsoft.VisualStudio.Workload.VCTools --quiet --wait"'
                    Write-Success 'VS Build Tools installed'
                } catch {
                    Write-Warn "VS Build Tools install failed: $_"
                    Write-Info 'npm install will likely fail. Re-run install manually before continuing.'
                }
            }
        }
    }
}

# ─── Step 5: Download source ────────────────────────────────────────────────
Write-Step 5 7 "Downloading da-mcp to $InstallDir ..."
if (Test-Path $InstallDir) {
    if ($Force) {
        Write-Info "Removing existing install (Force)..."
        Remove-Item -Path $InstallDir -Recurse -Force
    } else {
        Write-Fail "$InstallDir already exists. Use -Force to overwrite, or pick a different -InstallDir."
        exit 1
    }
}

if ($UseZip -or -not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Info 'Downloading source as ZIP...'
    $url = 'https://github.com/cioinside/da-mcp/archive/refs/heads/{0}.zip' -f $Ref
    $zipPath = Join-Path $env:TEMP 'da-mcp-install.zip'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
    # The archive expands to da-mcp-<ref>/ — move its contents up
    $inner = Get-ChildItem -Path $InstallDir -Directory | Select-Object -First 1
    if ($inner) {
        Get-ChildItem -Path $inner.FullName -Force | Move-Item -Destination $InstallDir -Force
        Remove-Item -Path $inner.FullName -Recurse -Force
    }
    Remove-Item -Path $zipPath -Force
    Write-Success 'Source downloaded (ZIP)'
} else {
    Write-Info "Cloning via git ($Ref)..."
    git clone --depth 1 --branch $Ref $Source $InstallDir
    if ($LASTEXITCODE -ne 0) { throw "git clone failed with exit $LASTEXITCODE" }
    Write-Success 'Source cloned'
}

# ─── Step 6: npm install + build ────────────────────────────────────────────
Write-Step 6 7 'Installing npm dependencies (robotjs compiles here, ~1-2 min)...'
Push-Location $InstallDir
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
    Write-Success 'npm install complete'

    if (-not $SkipBuild) {
        Write-Info 'Building TypeScript output...'
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
        Write-Success "Build complete: $InstallDir\dist\server.js"
    }

    if (-not $SkipTest) {
        Write-Info 'Running tests (mock mode — skips native calls)...'
        $env:DA_MCP_TEST_MODE = 'mock'
        npm test 2>&1 | Tee-Object -Variable testOut | Select-Object -Last 20
        if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
        if ($testOut -match '(\d+)\s+passed') {
            Write-Success "Tests: $($Matches[0])"
        }
    }
} finally {
    Pop-Location
}

# ─── Step 7: Print next steps ────────────────────────────────────────────────
Write-Step 7 7 'Done — printing MCP client config...'
$serverPath = Join-Path $InstallDir 'dist\server.js'
$configJson = @{
    mcpServers = @{
        'da-mcp' = @{
            command = 'node'
            args    = @($serverPath)
        }
    }
} | ConvertTo-Json -Compress

Write-Host ''
Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║              da-mcp installed successfully                 ║' -ForegroundColor Green
Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host "  Install path: $InstallDir" -ForegroundColor White
Write-Host "  Server entry: $serverPath" -ForegroundColor White
Write-Host ""
Write-Host '  Add this to your MCP client config (e.g. %APPDATA%\Claude\claude_desktop_config.json):' -ForegroundColor Cyan
Write-Host ''
Write-Host "  $configJson" -ForegroundColor White
Write-Host ''
Write-Host '  Test it:' -ForegroundColor Cyan
Write-Host "    node '"$serverPath"'" -ForegroundColor White
Write-Host '  (Then call tools/list from your MCP client — should return 12 tools.)'
Write-Host ''
Write-Host '  Run from source (dev mode, no build):' -ForegroundColor Cyan
Write-Host "    cd $InstallDir" -ForegroundColor White
Write-Host '    npx tsx src/server.ts' -ForegroundColor White
Write-Host ''
Write-Host '  Uninstall: run scripts\uninstall-windows.ps1' -ForegroundColor DarkGray
Write-Host ''
