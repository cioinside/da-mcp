$ErrorActionPreference = 'Stop'

$toolsDir   = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
$installDir = Join-Path $toolsDir 'da-mcp'

$packageName = $env:ChocolateyPackageName
$url         = 'https://github.com/cioinside/da-mcp/archive/refs/tags/v0.1.0.zip'
$url64bit    = $url
$checksum    = ''  # TODO: populate after tagging v0.1.0 — `Get-FileHash -Algorithm SHA256 v0.1.0.zip`
$checksum64  = $checksum
$checksumType    = 'sha256'
$checksumType64  = 'sha256'

# ─── Download + extract source ───────────────────────────────────────────────
$packageArgs = @{
    packageName    = $packageName
    unzipLocation  = $installDir
    url            = $url
    url64bit       = $url64bit
    checksum       = $checksum
    checksum64bit  = $checksum64
    checksumType   = $checksumType
    checksumType64 = $checksumType64
}

# Vanilla chocolatey does not auto-provision checksum; skip-when-empty
if ([string]::IsNullOrEmpty($checksum)) {
    $packageArgs.Remove('checksum')
    $packageArgs.Remove('checksum64bit')
    $packageArgs.Remove('checksumType')
    $packageArgs.Remove('checksumType64')
}

Install-ChocolateyZipPackage @packageArgs

# The zip expands to da-mcp-0.1.0/ — flatten up one level
$inner = Get-ChildItem -Path $installDir -Directory | Select-Object -First 1
if ($inner) {
    $tmpDir = Join-Path $toolsDir 'da-mcp-flat'
    New-Item -Path $tmpDir -ItemType Directory -Force | Out-Null
    Move-Item -Path (Join-Path $inner.FullName '*') -Destination $tmpDir -Force
    Remove-Item -Path $inner.FullName -Recurse -Force
    Move-Item -Path $tmpDir -Destination $installDir -Force
}

# ─── npm install + build ─────────────────────────────────────────────────────
Write-Host "Installing npm dependencies (compiles robotjs, ~1-2 min)..." -ForegroundColor Cyan
Set-Location $installDir
npm install --no-audit --no-fund 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }

Write-Host "Building TypeScript output..." -ForegroundColor Cyan
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }

# ─── Print post-install guidance ─────────────────────────────────────────────
$serverPath = Join-Path $installDir 'dist\server.js'

$httpUrl = ''
try {
    $env:DA_MCP_TRANSPORT = 'http'
    $httpUrl = (& node $serverPath token regenerate).Trim()
    Remove-Item Env:\DA_MCP_TRANSPORT -ErrorAction SilentlyContinue
} catch {
    Remove-Item Env:\DA_MCP_TRANSPORT -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '╔════════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '║              da-mcp installed via Chocolatey              ║' -ForegroundColor Green
Write-Host '╚════════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host "Server entry: $serverPath" -ForegroundColor White
Write-Host ''
Write-Host 'Add to your MCP client config:' -ForegroundColor Cyan
Write-Host ''
Write-Host '  {'                                                          -ForegroundColor White
Write-Host '    "mcpServers": {'                                          -ForegroundColor White
Write-Host '      "da-mcp": {'                                            -ForegroundColor White
Write-Host "        \"command\": \"node\",                                " -ForegroundColor White
Write-Host "        \"args\": [\"$serverPath\"]                          " -ForegroundColor White
Write-Host '      }'                                                      -ForegroundColor White
Write-Host '    }'                                                        -ForegroundColor White
Write-Host '  }'                                                          -ForegroundColor White
Write-Host ''
if ($httpUrl) {
    Write-Host 'HTTP transport (opt-in):' -ForegroundColor Cyan
    Write-Host '  Token (stored in %APPDATA%\da-mcp\token):' -ForegroundColor White
    Write-Host "  $httpUrl" -ForegroundColor White
    Write-Host "  Start: `$env:DA_MCP_TRANSPORT='http'; node '$serverPath'" -ForegroundColor White
    Write-Host "  Regenerate: node '$serverPath' token regenerate" -ForegroundColor White
    Write-Host ''
}
Write-Host 'Quick test (verifies server starts and exits cleanly):' -ForegroundColor Cyan
Write-Host "  Start-Process '$serverPath' -PassThru | Stop-Process"        -ForegroundColor White
