/**
 * macOS display enumeration: system_profiler JSON parsing + optional osascript
 * System Events bounds overlay. Mock mode is short-circuited upstream in
 * src/screenshot/index.ts and never reaches this module.
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { DisplayInfo } from '../platform/types.js'

interface SystemProfilerDisplay {
  _name?: string
  _spdisplays_resolution?: string
  spdisplays_pixelresolution?: string
  spdisplays_relationship?: string
  spdisplays_uiscreenscale?: string
}

interface SystemProfilerRoot {
  SPDisplaysDataType?: Array<{ spdisplays_ndrvs?: SystemProfilerDisplay[] }>
}

/** Synchronous shell:false capture; mirrors the linux list-windows helper. */
function spawnSyncCapture(
  bin: string,
  args: readonly string[],
): {
  status: number | null
  stdout: string
  stderr: string
  error: NodeJS.ErrnoException | null
} {
  const r = spawnSync(bin, [...args], { shell: false, encoding: 'utf8' })
  return {
    status: r.status,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    error: (r.error ?? null) as NodeJS.ErrnoException | null,
  }
}

// system_profiler resolution strings use "WIDTH x HEIGHT" with ASCII 'x'
// between single spaces; anything else is treated as malformed.
function parseResolution(s: string | undefined): { width: number; height: number } | null {
  if (typeof s !== 'string') return null
  const parts = s.split(' x ')
  if (parts.length !== 2) return null
  const w = Number.parseInt(parts[0] ?? '', 10)
  const h = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { width: w, height: h }
}

// spdisplays_main marks BUILT-IN, not primary. Primary comes from
// spdisplays_relationship when present; otherwise the first entry wins.
// Without osascript bounds, secondaries are placed horizontally next to the
// primary as a coarse heuristic (documented limitation).
export function parseSystemProfiler(stdout: string): DisplayInfo[] {
  let root: SystemProfilerRoot
  try {
    root = JSON.parse(stdout) as SystemProfilerRoot
  } catch {
    return []
  }
  const section = root.SPDisplaysDataType?.[0]
  if (!section || !Array.isArray(section.spdisplays_ndrvs)) return []

  const raw: Array<{
    name: string
    width: number
    height: number
    scale: number
    isMainRel: boolean
  }> = []
  for (const d of section.spdisplays_ndrvs) {
    const name = typeof d._name === 'string' ? d._name.trim() : ''
    if (name.length === 0) continue
    const res = parseResolution(d._spdisplays_resolution ?? d.spdisplays_pixelresolution)
    if (res === null) continue
    const scaleStr =
      typeof d.spdisplays_uiscreenscale === 'string' ? d.spdisplays_uiscreenscale : ''
    const scale = Number.parseFloat(scaleStr)
    raw.push({
      name,
      width: res.width,
      height: res.height,
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      isMainRel: d.spdisplays_relationship === 'spdisplays_yes',
    })
  }
  if (raw.length === 0) return []

  let primaryIdx = raw.findIndex((r) => r.isMainRel)
  if (primaryIdx < 0) primaryIdx = 0

  const out: DisplayInfo[] = []
  let primaryWidth = 0
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!
    const isPrimary = i === primaryIdx
    const x = !isPrimary && raw.length >= 2 && primaryWidth > 0 ? primaryWidth : 0
    out.push({
      id: i,
      name: r.name,
      isPrimary,
      bounds: { x, y: 0, width: r.width, height: r.height },
      scaleFactor: r.scale,
      rotation: 0,
    })
    if (isPrimary) primaryWidth = r.width
  }
  return out
}

// AppleScript `screens` iteration order is the system's display order; first
// entry is treated as primary. Orchestrator merges with sp data by name.
export function parseOsascriptScreenBounds(stdout: string): DisplayInfo[] {
  const out: DisplayInfo[] = []
  let idx = 0
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const pipe = line.indexOf('|')
    if (pipe < 0) continue
    const name = line.slice(0, pipe).trim()
    if (name.length === 0) continue
    const parts = line.slice(pipe + 1).split(',')
    if (parts.length !== 4) continue
    const x1 = Number.parseInt(parts[0] ?? '', 10)
    const y1 = Number.parseInt(parts[1] ?? '', 10)
    const x2 = Number.parseInt(parts[2] ?? '', 10)
    const y2 = Number.parseInt(parts[3] ?? '', 10)
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue
    out.push({
      id: idx,
      name,
      isPrimary: idx === 0,
      bounds: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
      scaleFactor: 1,
      rotation: 0,
    })
    idx++
  }
  return out
}

// osascript System Events can be denied by TCC on hardened macOS; failure is
// non-fatal — the orchestrator keeps the heuristic bounds from
// parseSystemProfiler when the overlay is unavailable.
export function listDisplaysMacos(): Promise<DisplayInfo[]> {
  const sp = spawnSyncCapture('system_profiler', ['SPDisplaysDataType', '-json'])
  if (sp.error !== null) {
    if (sp.error.code === 'ENOENT') {
      return Promise.reject(
        new DaMcpError('NATIVE_MISSING', 'system_profiler not on PATH', sp.error),
      )
    }
    return Promise.reject(
      new DaMcpError('NATIVE_FAILED', 'system_profiler failed to start', sp.error),
    )
  }
  if (sp.status !== 0) {
    return Promise.reject(
      new DaMcpError(
        'NATIVE_FAILED',
        `system_profiler exited with status ${String(sp.status)}: ${sp.stderr}`,
      ),
    )
  }
  const displays = parseSystemProfiler(sp.stdout)

  const script = [
    'tell application "System Events"',
    '  set out to ""',
    '  repeat with s in screens',
    '    try',
    '      set n to name of s',
    '      set b to bounds of s',
    '      set out to out & n & "|" & (item 1 of b) & "," & (item 2 of b) & "," & (item 3 of b) & "," & (item 4 of b) & linefeed',
    '    end try',
    '  end repeat',
    '  return out',
    'end tell',
  ].join('\n')
  const sa = spawnSyncCapture('osascript', ['-e', script])
  if (sa.error === null && sa.status === 0) {
    const overlay = new Map(
      parseOsascriptScreenBounds(sa.stdout).map((d) => [d.name, d.bounds] as const),
    )
    for (const d of displays) {
      const b = overlay.get(d.name)
      if (b !== undefined) d.bounds = b
    }
  }
  return Promise.resolve(displays)
}
