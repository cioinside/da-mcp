$ErrorActionPreference = 'Stop'

$toolsDir   = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
$installDir = Join-Path $toolsDir 'da-mcp'

if (Test-Path $installDir) {
    Write-Host "Removing $installDir ..." -ForegroundColor Cyan
    Remove-Item -Path $installDir -Recurse -Force
    Write-Host "Removed." -ForegroundColor Green
} else {
    Write-Host "Install dir not found: $installDir (already gone?)" -ForegroundColor Yellow
}

if ($env:DA_MCP_REMOVE_TOKEN -eq '1') {
    $tokenPath = Join-Path $env:APPDATA 'da-mcp\token'
    if (Test-Path $tokenPath) {
        Remove-Item -Path $tokenPath -Force
        Write-Host "Removed token: $tokenPath" -ForegroundColor Green
    } else {
        Write-Host "No token file at $tokenPath (already gone?)" -ForegroundColor Yellow
    }
}

# system-level dependencies (nodejs-lts, tesseract) are managed by
# chocolatey itself and removed automatically by `choco uninstall da-mcp`.
