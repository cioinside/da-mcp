/**
 * Parser unit tests for the three `da_list_displays` backends (Linux,
 * macOS, Windows). All four Linux parsers and both macOS parsers are pure
 * functions — they accept stdout strings and return DisplayInfo[]. The
 * Windows / Linux / macOS orchestrators shell out to native binaries that
 * aren't installed in CI and are exercised via `da_list_displays` in mock
 * mode (which short-circuits before reaching the dispatch switch).
 */
import { describe, it, expect } from 'vitest'

import { parsePowerShellScreens } from '../../src/screenshot/list-displays-windows.js'
import {
  parseSystemProfiler,
  parseOsascriptScreenBounds,
} from '../../src/screenshot/list-displays-macos.js'
import {
  parseXrandrListMonitors,
  parseXrandrQuery,
  parseWlrRandr,
  parseSwaymsg,
} from '../../src/screenshot/list-displays-linux.js'

const di = (overrides: {
  id?: number
  name?: string
  isPrimary?: boolean
  x?: number
  y?: number
  width: number
  height: number
  scale?: number
  rotation?: 0 | 90 | 180 | 270
}) => ({
  id: overrides.id ?? 0,
  name: overrides.name ?? '',
  isPrimary: overrides.isPrimary ?? false,
  bounds: { x: overrides.x ?? 0, y: overrides.y ?? 0, width: overrides.width, height: overrides.height },
  scaleFactor: overrides.scale ?? 1,
  rotation: overrides.rotation ?? 0,
})

// ─── Windows: parsePowerShellScreens ──────────────────────────────────────

describe('parsePowerShellScreens', () => {
  it('parses dual-monitor with primary marker', () => {
    const stdout = '\\\\.\\DISPLAY1|true|0,0,1920,1080\n\\\\.\\DISPLAY2|false|1920,0,1280,1024\n'
    expect(parsePowerShellScreens(stdout)).toEqual([
      di({ id: 0, name: '\\\\.\\DISPLAY1', isPrimary: true, width: 1920, height: 1080 }),
      di({ id: 1, name: '\\\\.\\DISPLAY2', width: 1280, height: 1024, x: 1920 }),
    ])
  })

  it('handles negative coords', () => {
    const stdout = '\\\\.\\DISPLAY1|true|0,0,1920,1080\n\\\\.\\DISPLAY2|false|-1920,200,1920,1080\n'
    const d = parsePowerShellScreens(stdout)[1]
    expect(d?.bounds.x).toBe(-1920)
    expect(d?.bounds.y).toBe(200)
  })

  it('skips disconnected displays (width or height 0)', () => {
    const stdout = '\\\\.\\DISPLAY1|true|0,0,1920,1080\n\\\\.\\DISPLAY2|false|1920,0,0,0\n\\\\.\\DISPLAY3|false|1920,0,1280,1024\n'
    const displays = parsePowerShellScreens(stdout)
    expect(displays).toHaveLength(2)
    expect(displays[1]?.id).toBe(2)
  })

  it('skips malformed lines silently', () => {
    const stdout = '\\\\.\\DISPLAY1|true|0,0,1920,1080\nrandom\na|b\na|b|c|d\ntruthy|x|0,0,1920,1080\n0,0,abc,1080\n0,0,1920\n0,0,1920,1080,extra\n'
    expect(parsePowerShellScreens(stdout)).toHaveLength(1)
  })

  it('returns [] for empty / whitespace-only stdout', () => {
    expect(parsePowerShellScreens('')).toEqual([])
    expect(parsePowerShellScreens('\r\n\r\n\n\n')).toEqual([])
  })
})

// ─── macOS: parseSystemProfiler + parseOsascriptScreenBounds ──────────────

describe('parseSystemProfiler', () => {
  it('parses single Retina with explicit scale', () => {
    const stdout = JSON.stringify({
      SPDisplaysDataType: [{ spdisplays_ndrvs: [{
        _name: 'Color LCD', _spdisplays_resolution: '2880 x 1800',
        spdisplays_main: 'spdisplays_yes', spdisplays_uiscreenscale: '2.0',
      }] }],
    })
    expect(parseSystemProfiler(stdout)).toEqual([
      di({ id: 0, name: 'Color LCD', isPrimary: true, width: 2880, height: 1800, scale: 2.0 }),
    ])
  })

  it('uses spdisplays_relationship for primary', () => {
    const stdout = JSON.stringify({
      SPDisplaysDataType: [{ spdisplays_ndrvs: [
        { _name: 'DELL', _spdisplays_resolution: '2560 x 1440', spdisplays_relationship: 'spdisplays_yes' },
        { _name: 'LCD', _spdisplays_resolution: '1440 x 900' },
      ] }],
    })
    const displays = parseSystemProfiler(stdout)
    expect(displays[0]?.isPrimary).toBe(true)
    expect(displays[0]?.name).toBe('DELL')
    expect(displays[1]?.bounds.x).toBe(2560)
  })

  it('falls back to first entry when no relationship flag', () => {
    const stdout = JSON.stringify({
      SPDisplaysDataType: [{ spdisplays_ndrvs: [
        { _name: 'A', _spdisplays_resolution: '1920 x 1080' },
        { _name: 'B', _spdisplays_resolution: '3840 x 2160' },
      ] }],
    })
    const displays = parseSystemProfiler(stdout)
    expect(displays[0]?.isPrimary).toBe(true)
    expect(displays[1]?.bounds.x).toBe(1920)
  })

  it('returns [] for malformed JSON or missing key', () => {
    expect(parseSystemProfiler('{not json')).toEqual([])
    expect(parseSystemProfiler(JSON.stringify({}))).toEqual([])
    expect(parseSystemProfiler(JSON.stringify({ SPDisplaysDataType: [] }))).toEqual([])
  })

  it('skips entries with empty name or unparseable resolution, defaults scale to 1', () => {
    const stdout = JSON.stringify({
      SPDisplaysDataType: [{ spdisplays_ndrvs: [
        { _name: 'OK', _spdisplays_resolution: '1920 x 1080' },
        { _name: 'Bad', _spdisplays_resolution: 'garbage' },
        { _spdisplays_resolution: '1024 x 768' },
        { _name: 'NoScale', _spdisplays_resolution: '1024 x 768', spdisplays_uiscreenscale: 'abc' },
      ] }],
    })
    const displays = parseSystemProfiler(stdout)
    expect(displays).toHaveLength(2)
    expect(displays[1]?.scaleFactor).toBe(1)
  })
})

describe('parseOsascriptScreenBounds', () => {
  it('parses dual display with negative x for secondary to the left', () => {
    const stdout = 'Color LCD|0,0,1440,900\nExternal|-2560,0,0,1440\n'
    expect(parseOsascriptScreenBounds(stdout)).toEqual([
      di({ id: 0, name: 'Color LCD', isPrimary: true, width: 1440, height: 900 }),
      di({ id: 1, name: 'External', width: 2560, height: 1440, x: -2560 }),
    ])
  })

  it('skips malformed lines silently and preserves names with spaces', () => {
    const stdout = 'broken\nColor LCD|0,0,2880,1800\nBad|0,0,2880\nDELL U2719D|2560,0,5120,1440\n'
    const displays = parseOsascriptScreenBounds(stdout)
    expect(displays).toHaveLength(2)
    expect(displays[1]?.name).toBe('DELL U2719D')
  })

  it('returns [] for empty stdout', () => {
    expect(parseOsascriptScreenBounds('')).toEqual([])
  })
})

// ─── Linux: 4 parsers ────────────────────────────────────────────────────

describe('parseXrandrListMonitors', () => {
  it('parses typical xrandr 1.5+ dual-monitor output', () => {
    const stdout = 'Monitors: 2\n 0: +*HDMI-1 1920/508x1080/285+0+0  HDMI-1\n 1: +DP-1 1280/339x720/190+1920+0  DP-1\n'
    expect(parseXrandrListMonitors(stdout)).toEqual([
      di({ id: 0, name: 'HDMI-1', isPrimary: true, width: 1920, height: 1080 }),
      di({ id: 1, name: 'DP-1', width: 1280, height: 720, x: 1920 }),
    ])
  })

  it('returns [] for empty / unrelated content', () => {
    expect(parseXrandrListMonitors('')).toEqual([])
    expect(parseXrandrListMonitors('Screen 0: minimum 320 x 200')).toEqual([])
  })
})

describe('parseXrandrQuery', () => {
  it('skips Screen metadata line and parses connected displays', () => {
    const stdout = [
      'Screen 0: minimum 320 x 200, current 3840 x 1080, maximum 16384 x 16384',
      'HDMI-1 connected 1920x1080+0+0 (normal left inverted right x axis y axis) 508mm x 285mm',
      'DP-1 connected 1280x720+1920+0 (normal left inverted right x axis y axis) 339mm x 190mm',
    ].join('\n')
    const displays = parseXrandrQuery(stdout)
    expect(displays).toHaveLength(2)
    expect(displays[0]?.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('honors explicit "primary" keyword and falls back to unique +0+0', () => {
    const a = [
      'HDMI-1 connected primary 1920x1080+0+0 (normal) 508mm x 285mm',
      'DP-1 connected 1280x720+1920+0 (normal) 339mm x 190mm',
    ].join('\n')
    expect(parseXrandrQuery(a)[0]?.isPrimary).toBe(true)

    const b = [
      'HDMI-1 connected 1920x1080+0+0 (normal) 508mm x 285mm',
      'DP-1 connected 1280x720+1920+0 (normal) 339mm x 190mm',
    ].join('\n')
    const displays = parseXrandrQuery(b)
    expect(displays[0]?.isPrimary).toBe(true)
    expect(displays[1]?.isPrimary).toBe(false)
  })

  it('returns [] when no connected lines exist', () => {
    expect(parseXrandrQuery('Screen 0: minimum 320 x 200')).toEqual([])
  })
})

describe('parseWlrRandr', () => {
  it('parses dual-block output with position, mode, scale, transform', () => {
    const stdout = [
      'HDMI-A-1 "HP ZR30w"', '  Position: 0,0', '  Mode: 2560x1600 (preferred)',
      '  Scale: 1.000000', '  Transform: normal', '',
      'DP-2 "Dell U2719D"', '  Position: 2560,0', '  Mode: 2560x1440',
      '  Scale: 1.000000', '  Transform: 90', '',
    ].join('\n')
    const displays = parseWlrRandr(stdout)
    expect(displays).toHaveLength(2)
    expect(displays[0]?.isPrimary).toBe(true)
    expect(displays[1]?.rotation).toBe(90)
  })

  it('skips "No monitor" headers and "Mode: disabled" blocks', () => {
    const stdout = [
      'HDMI-A-1 No monitor', '  Position: 0,0', '',
      'DP-1 "Active"', '  Position: 0,0', '  Mode: disabled', '',
    ].join('\n')
    expect(parseWlrRandr(stdout)).toEqual([])
  })

  it('extracts refresh rate when present in Mode line', () => {
    const stdout = [
      'HDMI-A-1 "Test"', '  Position: 0,0', '  Mode: 1920x1080 @ 144.00Hz', '  Scale: 1', '',
    ].join('\n')
    const d = parseWlrRandr(stdout)[0]
    expect(d?.refreshRateHz).toBe(144)
    expect(d?.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })
})

describe('parseSwaymsg', () => {
  it('parses JSON array, filters inactive, applies explicit primary', () => {
    const stdout = JSON.stringify([
      { name: 'A', primary: true, active: true, rect: { x: 0, y: 0, width: 2560, height: 1600 }, scale: 1, transform: 'normal' },
      { name: 'B', primary: false, active: true, rect: { x: 2560, y: 0, width: 2560, height: 1440 }, scale: 1, transform: 'normal' },
      { name: 'C', active: false, rect: { x: 0, y: 0, width: 0, height: 0 } },
    ])
    const displays = parseSwaymsg(stdout)
    expect(displays).toHaveLength(2)
    expect(displays[0]?.isPrimary).toBe(true)
    expect(displays[1]?.name).toBe('B')
  })

  it('picks first active as primary when no entry has primary:true', () => {
    const stdout = JSON.stringify([
      { name: 'A', active: true, rect: { x: 0, y: 0, width: 100, height: 100 }, transform: 'normal', scale: 1 },
      { name: 'B', active: true, rect: { x: 100, y: 0, width: 100, height: 100 }, transform: 'normal', scale: 1 },
    ])
    expect(parseSwaymsg(stdout)[0]?.isPrimary).toBe(true)
  })

  it('returns [] for malformed JSON or no active entries', () => {
    expect(parseSwaymsg('not json')).toEqual([])
    expect(parseSwaymsg(JSON.stringify([{ name: 'A', active: false, rect: {} }]))).toEqual([])
  })
})