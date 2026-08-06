#!/usr/bin/env node
// Cross-platform launcher for da-mcp on the LAN.
//
// Sets DA_MCP_TRANSPORT=http and DA_MCP_HTTP_HOST=0.0.0.0, then spawns
// the existing CLI entry-point. The token is already on disk from a
// previous run; if it is missing, the server creates one on first start.
// We deliberately do NOT auto-open the host firewall — that requires
// elevation and varies wildly per OS. The wrapper prints the manual
// command needed on each platform after the server starts.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const distEntry = resolve(repoRoot, 'dist/server-dispatch.js')
const srcEntry = resolve(repoRoot, 'src/server-dispatch.ts')
const tsxBin = resolve(repoRoot, 'node_modules/.bin/tsx')

let command, args
if (existsSync(distEntry)) {
  command = process.execPath
  args = [distEntry]
} else if (existsSync(srcEntry) && existsSync(tsxBin)) {
  command = tsxBin
  args = [srcEntry]
} else {
  console.error('Could not find dist/server-dispatch.js or src/server-dispatch.ts.')
  console.error('Run `npm run build` first, or run from a git checkout with deps installed.')
  process.exit(1)
}

const port = process.env['DA_MCP_PORT'] ?? '3000'
console.log(`da-mcp: starting on 0.0.0.0:${port} (LAN mode).`)
console.log('da-mcp: env  — DA_MCP_TRANSPORT=http, DA_MCP_HTTP_HOST=0.0.0.0')
console.log('da-mcp: firewall — open inbound TCP', port, 'before connecting from another host.')
if (process.platform === 'win32') {
  console.log('  Windows:  New-NetFirewallRule -Direction Inbound -LocalPort', `${port} -Protocol TCP -Action Allow`)
} else if (process.platform === 'darwin') {
  console.log('  macOS:    System Settings → Network → Firewall → allow node to accept incoming connections')
} else {
  console.log('  Linux:    sudo ufw allow', `${port}/tcp`, '  OR  sudo iptables -A INPUT -p tcp --dport', port, '-j ACCEPT')
}
console.log('da-mcp: token — read from', tokenPathForPlatform(), 'or regenerate via `node dist/server-dispatch.js token regenerate`')
console.log('')

const child = spawn(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    DA_MCP_TRANSPORT: 'http',
    DA_MCP_HTTP_HOST: '0.0.0.0',
  },
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig)
  })
}

child.on('exit', (code, signal) => {
  if (signal !== null && signal !== undefined) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})

function tokenPathForPlatform() {
  if (process.env['DA_MCP_TOKEN_PATH']) return process.env['DA_MCP_TOKEN_PATH']
  if (process.platform === 'win32') {
    return `${process.env['APPDATA'] ?? '%APPDATA%'}\\da-mcp\\token`
  }
  if (process.platform === 'darwin') {
    return '~/Library/Application Support/da-mcp/token'
  }
  const xdg = process.env['XDG_CONFIG_HOME']
  return xdg !== undefined && xdg.length > 0
    ? `${xdg}/da-mcp/token`
    : '~/.config/da-mcp/token'
}
