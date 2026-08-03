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

# system-level dependencies (nodejs-lts, tesseract) are managed by
# chocolatey itself and removed automatically by `choco uninstall da-mcp`.
