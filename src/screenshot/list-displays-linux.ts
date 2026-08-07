import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { DisplayInfo, Rect } from '../platform/types.js'

type DisplayServerId = 'x11' | 'wayland' | 'native' | 'unknown'
type Rotation = DisplayInfo['rotation']

function spawnSyncCapture(bin: string, args: readonly string[], context: string): string {
  const result = spawnSync(bin, args as string[], {
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError('NATIVE_MISSING', `${context}: '${bin}' not found on PATH`)
    }
    throw new DaMcpError('NATIVE_FAILED', `${context}: '${bin}' failed to start`, err)
  }
  if (result.status !== 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `${context}: '${bin}' exited with status ${String(result.status)}: ${result.stderr ?? ''}`,
    )
  }
  return result.stdout ?? ''
}

function parseRotation(value: string | undefined): Rotation {
  switch (value) {
    case '90':
    case 'flipped-90':
      return 90
    case '180':
    case 'flipped-180':
      return 180
    case '270':
    case 'flipped-270':
      return 270
    case 'normal':
    case 'flipped':
    default:
      return 0
  }
}

// Reads `<w>x<h>+<x>+<y>` from a substring. Returns null on parse failure.
function geometry(s: string | undefined): Pick<Rect, 'x' | 'y' | 'width' | 'height'> | null {
  const m = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/.exec(s ?? '')
  if (m === null) return null
  const w = Number.parseInt(m[1] ?? '0', 10)
  const h = Number.parseInt(m[2] ?? '0', 10)
  const x = Number.parseInt(m[3] ?? '0', 10)
  const y = Number.parseInt(m[4] ?? '0', 10)
  if (w <= 0 || h <= 0) return null
  return { x, y, width: w, height: h }
}

// Returns the atOrigin index (or -1) within `arr`, picking first by default.
function pickPrimaryIndex(arr: readonly DisplayInfo[]): number {
  if (arr.length === 0) return -1
  if (arr.length === 1) return 0
  const atOrigin = arr.findIndex(d => d.bounds.x === 0 && d.bounds.y === 0)
  return atOrigin === 0 || atOrigin > 0 ? atOrigin : 0
}

export function parseXrandrListMonitors(stdout: string): DisplayInfo[] {
  const out: DisplayInfo[] = []
  const re = /^\s*(\d+):\s+\+(\*?)([\w-]+)\s+(\d+)\/\d+x(\d+)\/\d+\+(-?\d+)\+(-?\d+)/
  for (const line of stdout.split('\n')) {
    const m = re.exec(line)
    if (m === null) continue
    const id = Number.parseInt(m[1] ?? '', 10)
    const w = Number.parseInt(m[4] ?? '0', 10)
    const h = Number.parseInt(m[5] ?? '0', 10)
    const x = Number.parseInt(m[6] ?? '0', 10)
    const y = Number.parseInt(m[7] ?? '0', 10)
    if (!Number.isInteger(id) || id < 0) continue
    if (w <= 0 || h <= 0) continue
    out.push({
      id,
      name: m[3] ?? '',
      isPrimary: (m[2] ?? '') === '*',
      bounds: { x, y, width: w, height: h },
      scaleFactor: 1,
      rotation: 0,
    })
  }
  return out
}

export function parseXrandrQuery(stdout: string): DisplayInfo[] {
  const out: DisplayInfo[] = []
  const re = /^\s*(\S+)\s+connected\s+(primary\s+)?(\d+x\d+\+[+\-0-9]+)/
  for (const line of stdout.split('\n')) {
    if (/^\s*Screen\s/.test(line)) continue
    const m = re.exec(line)
    if (m === null) continue
    const g = geometry(m[3])
    if (g === null) continue
    out.push({
      id: out.length,
      name: m[1] ?? '',
      isPrimary: (m[2] ?? '').trim() === 'primary',
      bounds: g,
      scaleFactor: 1,
      rotation: 0,
    })
  }
  if (out.length === 0 || out.some(d => d.isPrimary)) return out
  const idx = pickPrimaryIndex(out)
  if (idx >= 0) out[idx]!.isPrimary = true
  return out
}

export function parseWlrRandr(stdout: string): DisplayInfo[] {
  const blocks = stdout.split(/\n\s*\n/)
  const prelim: DisplayInfo[] = []
  let idx = 0
  for (const raw of blocks) {
    const block = raw.trim()
    if (block.length === 0) continue
    const lines = block.split('\n')
    const header = /^(\S+)\s+(.*)$/.exec(lines[0] ?? '')
    if (header === null) continue
    if ((header[2] ?? '').trim() === 'No monitor') continue
    let posX = 0, posY = 0, modeW = 0, modeH = 0, scale = 1
    let transform: Rotation = 0
    let refreshRateHz: number | undefined
    for (const line of lines.slice(1)) {
      const posM = /^\s*Position:\s+(-?\d+),(-?\d+)/.exec(line)
      if (posM !== null) { posX = Number.parseInt(posM[1] ?? '0', 10); posY = Number.parseInt(posM[2] ?? '0', 10); continue }
      const modeM = /^\s*Mode:\s+(\d+)x(\d+)/.exec(line)
      if (modeM !== null) {
        modeW = Number.parseInt(modeM[1] ?? '0', 10)
        modeH = Number.parseInt(modeM[2] ?? '0', 10)
        const refM = /@\s+([\d.]+)/.exec(line)
        if (refM !== null) {
          const r = Number.parseFloat(refM[1] ?? '')
          if (Number.isFinite(r) && r > 0) refreshRateHz = r
        }
        continue
      }
      if (/^\s*Mode:\s+disabled/i.test(line)) { modeW = 0; modeH = 0; continue }
      const scaleM = /^\s*Scale:\s+([\d.]+)/.exec(line)
      if (scaleM !== null) { scale = Number.parseFloat(scaleM[1] ?? '1'); continue }
      const transM = /^\s*Transform:\s+(\S+)/.exec(line)
      if (transM !== null) { transform = parseRotation(transM[1] ?? 'normal'); continue }
    }
    if (modeW <= 0 || modeH <= 0) continue
    prelim.push({
      id: idx++,
      name: header[1] ?? '',
      isPrimary: posX === 0 && posY === 0,
      bounds: { x: posX, y: posY, width: modeW, height: modeH },
      scaleFactor: Number.isFinite(scale) && scale > 0 ? scale : 1,
      rotation: transform,
      ...(refreshRateHz !== undefined ? { refreshRateHz } : {}),
    })
  }
  if (prelim.length === 0) return prelim
  for (const d of prelim) d.isPrimary = false
  const idx2 = pickPrimaryIndex(prelim)
  if (idx2 >= 0) prelim[idx2]!.isPrimary = true
  return prelim
}

export function parseSwaymsg(stdout: string): DisplayInfo[] {
  type Entry = { raw: Record<string, unknown>; primary: boolean }
  let data: unknown
  try { data = JSON.parse(stdout) } catch { return [] }
  if (!Array.isArray(data)) return []
  const active: Entry[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    if (o['active'] !== true) continue
    active.push({ raw: o, primary: o['primary'] === true })
  }
  if (active.length === 0) return []
  let primaryIdx = active.findIndex(a => a.primary)
  if (primaryIdx < 0) primaryIdx = 0
  const out: DisplayInfo[] = []
  for (let i = 0; i < active.length; i++) {
    const a = active[i]
    if (a === undefined) continue
    const rect = (typeof a.raw['rect'] === 'object' && a.raw['rect'] !== null)
      ? (a.raw['rect'] as Record<string, unknown>)
      : {}
    const w = Number(rect['width'] ?? 0)
    const h = Number(rect['height'] ?? 0)
    if (w <= 0 || h <= 0) continue
    const x = Number(rect['x'] ?? 0)
    const y = Number(rect['y'] ?? 0)
    const name = typeof a.raw['name'] === 'string' ? a.raw['name'] : ''
    const scaleRaw = Number(a.raw['scale'] ?? 1)
    const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1
    const transformStr = typeof a.raw['transform'] === 'string' ? a.raw['transform'] : 'normal'
    out.push({
      id: i,
      name,
      isPrimary: i === primaryIdx,
      bounds: { x, y, width: w, height: h },
      scaleFactor: scale,
      rotation: parseRotation(transformStr),
    })
  }
  return out
}

export async function listDisplaysLinux(display: DisplayServerId): Promise<DisplayInfo[]> {
  const isWayland = display === 'wayland'
  let installHint: string
  if (isWayland) {
    installHint = 'wlr-randr, swaymsg, or xrandr (XWayland fallback)'
    try {
      const out = spawnSyncCapture('wlr-randr', [], 'wlr-randr')
      const parsed = parseWlrRandr(out)
      if (parsed.length > 0) return parsed
    } catch (e) {
      if (!(e instanceof DaMcpError && (e.code === 'NATIVE_MISSING' || e.code === 'NATIVE_FAILED'))) throw e
    }
    try {
      const out = spawnSyncCapture('swaymsg', ['-t', 'get_outputs'], 'swaymsg -t get_outputs')
      const parsed = parseSwaymsg(out)
      if (parsed.length > 0) return parsed
    } catch (e) {
      if (!(e instanceof DaMcpError && (e.code === 'NATIVE_MISSING' || e.code === 'NATIVE_FAILED'))) throw e
    }
  } else {
    installHint = 'xrandr (install via x11-utils / xrandr package)'
    try {
      const out = spawnSyncCapture('xrandr', ['--listmonitors'], 'xrandr --listmonitors')
      const parsed = parseXrandrListMonitors(out)
      if (parsed.length > 0) return parsed
    } catch (e) {
      if (!(e instanceof DaMcpError && (e.code === 'NATIVE_MISSING' || e.code === 'NATIVE_FAILED'))) throw e
    }
  }
  try {
    const out = spawnSyncCapture('xrandr', ['--query'], 'xrandr --query')
    return parseXrandrQuery(out)
  } catch (e) {
    if (e instanceof DaMcpError && e.code === 'NATIVE_MISSING') {
      throw new DaMcpError(
        'NATIVE_MISSING',
        `Linux display enumeration requires ${installHint}; install via your package manager.`,
      )
    }
    throw e
  }
}