# Chocolatey package for da-mcp

Distributes `da-mcp` via the [Chocolatey](https://chocolatey.org/) package manager for Windows:

```powershell
choco install da-mcp
```

That single command provisions Node.js 22+, tesseract, downloads the source, runs `npm install` + `npm run build`, and leaves you with a working server at:

```
$env:ChocolateyInstall\lib\da-mcp\tools\da-mcp\dist\server.js
```

## Files in this folder

| File | Purpose |
|---|---|
| `da-mcp.nuspec` | Package metadata (id, version, dependencies, tags) |
| `tools/chocolateyinstall.ps1` | Runs on `choco install da-mcp` |
| `tools/chocolateyuninstall.ps1` | Runs on `choco uninstall da-mcp` |
| `tools/VERIFICATION.txt` | Smoke-test checks (run by `choco test` if you publish a `.tests` package) |

## Build the package locally

```powershell
cd packaging\chocolatey

# Download the matching source archive (only needed once per release)
Invoke-WebRequest `
  -Uri https://github.com/cioinside/da-mcp/archive/refs/tags/v0.1.0.zip `
  -OutFile v0.1.0.zip

# Compute SHA256 for the .nuspec
$hash = (Get-FileHash -Algorithm SHA256 v0.1.0.zip).Hash
# Paste $hash into the $checksum field in tools/chocolateyinstall.ps1

# Build the .nupkg
choco pack
# -> da-mcp.0.1.0.nupkg
```

## Test the package locally

```powershell
# Install from local source
choco install da-mcp -s .

# Verify
choco uninstall da-mcp --what-if   # dry run, prints the cleanup plan
```

## Publish to chocolatey.org

1. Create an account at <https://community.chocolatey.org/account>
2. Copy your API key from <https://community.chocolatey.org/account>:
   ```powershell
   choco apikey -k <your-api-key> -s https://push.chocolatey.org/
   ```
3. Push the package:
   ```powershell
   choco push da-mcp.0.1.0.nupkg -s https://push.chocolatey.org/
   ```
4. The moderation queue takes ~3–7 days for new maintainers; subsequent packages approve faster.

## Upgrade procedure

For each new release:

1. Bump version in `da-mcp.nuspec` (must be > existing version)
2. Tag the Git repo: `git tag v0.2.0 && git push --tags`
3. Update `tools/chocolateyinstall.ps1`:
   - `$url` → `v0.2.0.zip`
   - `$checksum` → new SHA256
4. `choco pack`
5. `choco push da-mcp.0.2.0.nupkg -s https://push.chocolatey.org/`

## Why PowerShell installer + Chocolatey?

Both have a place:

| Scenario | Use |
|---|---|
| Developer has PowerShell, wants source-tree access | `scripts\install-windows.ps1` |
| End-user wants one-liner install, deps auto-handled | `choco install da-mcp` |
| Air-gapped / no network | Copy source ZIP + `install-windows.ps1 -SkipSystemDeps` |
| CI in Windows VM | `install-windows.ps1 -SkipSystemDeps -SkipTest -Force` |

The PowerShell script and the Chocolatey package both produce the same
runtime install — they're alternative entry points to the same artifact.
