/**
 * Tests for the cross-platform window subsystem.
 *
 * Pure helpers (`matchOne`) are exhaustively tested. I/O functions
 * (`listWindows`, `focusWindow`, `resolveWindow`) are tested under
 * `DA_MCP_TEST_MODE=mock` so the real-OS paths don't run during unit
 * tests — that work belongs in the e2e suite where it can spawn actual
 * `wmctrl`/`osascript`/`powershell.exe` against the host OS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DaMcpError } from '../../src/errors.js'
import { initConfig, resetConfig } from '../../src/config.js'
import {
  MOCK_WINDOWS,
  listWindows,
  focusWindow,
  resolveWindow,
  matchOne,
} from '../../src/window/index.js'
import { WIN_FOCUS_PS1, WIN_FOCUS_SCRIPT } from '../../src/window/focus.js'
import type { WindowInfo } from '../../src/window/types.js'

// ─── Top-level mock mode: DA_MCP_TEST_MODE=mock ──────────────────────────────
//
// `listWindows` and `focusWindow` call `isMockMode()` (from src/input/routing.ts)
// which reads `getConfig().testMode`. So we have to bootstrap the config singleton
// before any window call — same pattern as test/unit/input.test.ts.

beforeAll(() => {
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'mock' })
})

afterAll(() => {
  resetConfig()
})

// Track the sample window fixtures for assertion.
const WIN_A: WindowInfo = MOCK_WINDOWS[0]!
const WIN_B: WindowInfo = {
  hwnd: 0x200002,
  pid: 5151,
  title: 'Mock Window B — Paint',
  rect: { x: 50, y: 50, width: 400, height: 300 },
  isVisible: true,
}
const WIN_C: WindowInfo = {
  hwnd: 0x300003,
  pid: 5151, // same pid as WIN_B — proves pid is a filter, not unique
  title: 'Mock Window C — also Paint',
  rect: { x: 0, y: 0, width: 200, height: 100 },
  isVisible: true,
}

const SAMPLE: readonly WindowInfo[] = [WIN_A, WIN_B, WIN_C]

// ─── matchOne — pure helper ──────────────────────────────────────────────────

describe('matchOne', () => {
  it('returns null for empty all-list', () => {
    expect(matchOne([], { hwnd: 1 })).toBeNull()
    expect(matchOne([], { title: 'x' })).toBeNull()
  })

  it('exact hwnd match', () => {
    expect(matchOne(SAMPLE, { hwnd: WIN_B.hwnd })).toEqual(WIN_B)
  })

  it('hwnd + matching pid is accepted', () => {
    expect(matchOne(SAMPLE, { hwnd: WIN_B.hwnd, pid: WIN_B.pid })).toEqual(WIN_B)
  })

  it('hwnd + mismatching pid rejects', () => {
    expect(matchOne(SAMPLE, { hwnd: WIN_B.hwnd, pid: 9999 })).toBeNull()
  })

  it('title substring is case-insensitive', () => {
    expect(matchOne(SAMPLE, { title: 'paint' })).toEqual(WIN_B)
    expect(matchOne(SAMPLE, { title: 'PAINT' })).toEqual(WIN_B)
    expect(matchOne(SAMPLE, { title: 'PaInT' })).toEqual(WIN_B)
  })

  it('title + pid narrows when multiple match by title', () => {
    // Both WIN_B and WIN_C have title containing "Paint" with pid 5151 — pid
    // doesn't disambiguate here; the function returns first match. This is
    // intentional per the resolver contract: first match wins, caller should
    // supply a more specific title if disambiguation is required.
    expect(matchOne(SAMPLE, { title: 'Paint', pid: 5151 })?.hwnd).toBe(WIN_B.hwnd)
  })

  it('title + mismatching pid rejects even when title matches', () => {
    expect(matchOne(SAMPLE, { title: 'Paint', pid: 9999 })).toBeNull()
  })

  it('no title match returns null', () => {
    expect(matchOne(SAMPLE, { title: 'NoSuchWindow' })).toBeNull()
  })

  it('hwnd takes precedence over title (caller explicit hwnd wins)', () => {
    // WIN_A has title "Untitled"; WIN_B has title "Paint". Searching by title
    // "Paint" yields WIN_B, but if hwnd=WIN_A.hwnd is also supplied, that wins.
    expect(matchOne(SAMPLE, { hwnd: WIN_A.hwnd, title: 'Paint' })).toEqual(WIN_A)
  })
})

// ─── resolveWindow — validation + mock-mode dispatch ─────────────────────────

describe('resolveWindow (mock mode)', () => {
  it('rejects empty request (neither hwnd nor title)', () => {
    expect(() => resolveWindow({})).toThrow(DaMcpError)
    expect(() => resolveWindow({})).toThrow(/requires either hwnd or title/)
  })

  it('rejects non-positive hwnd', () => {
    expect(() => resolveWindow({ hwnd: 0 })).toThrow(DaMcpError)
    expect(() => resolveWindow({ hwnd: -1 })).toThrow(DaMcpError)
    expect(() => resolveWindow({ hwnd: 1.5 })).toThrow(DaMcpError)
  })

  it('rejects empty title string', () => {
    expect(() => resolveWindow({ title: '' })).toThrow(DaMcpError)
  })

  it('rejects negative pid', () => {
    expect(() => resolveWindow({ title: 'paint', pid: -1 })).toThrow(DaMcpError)
  })

  it('returns null (not throws) when no window matches', () => {
    expect(resolveWindow({ hwnd: 0x999999 })).toBeNull()
    expect(resolveWindow({ title: 'NoSuchTitleAnywhere' })).toBeNull()
  })

  it('matches in mock mode against MOCK_WINDOWS', () => {
    // MOCK_WINDOWS's first window has title "Mock Window — Untitled".
    const found = resolveWindow({ title: 'untitled' })
    expect(found).toEqual(MOCK_WINDOWS[0])
  })
})

// ─── listWindows / focusWindow under mock mode ───────────────────────────────
//
// Real-OS paths are exercised by the e2e suite (test/e2e/) on the actual host
// OS. These tests verify the mock-mode contract only.

describe('listWindows (mock mode)', () => {
  it('returns MOCK_WINDOWS', () => {
    expect(listWindows()).toEqual(MOCK_WINDOWS)
  })

  it('returns a fresh array (not the frozen singleton reference)', () => {
    const a = listWindows()
    const b = listWindows()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

describe('focusWindow (mock mode)', () => {
  it('returns the input echoed with foreground=true', () => {
    const out = focusWindow(0x100001, 'Mock Window — Untitled', 4242, true)
    expect(out.hwnd).toBe(0x100001)
    expect(out.title).toBe('Mock Window — Untitled')
    expect(out.pid).toBe(4242)
    expect(out.foreground).toBe(true)
  })

  it('rejects non-positive hwnd', () => {
    expect(() => focusWindow(0, 'x', 1, true)).toThrow(DaMcpError)
    expect(() => focusWindow(-1, 'x', 1, true)).toThrow(DaMcpError)
    expect(() => focusWindow(1.5, 'x', 1, true)).toThrow(DaMcpError)
  })

  it('respects bringToTop flag in mock mode (echoes, no real effect)', () => {
    expect(focusWindow(1, 'x', 1, false).foreground).toBe(true)
    expect(focusWindow(1, 'x', 1, true).foreground).toBe(true)
  })
})

// ─── WIN_FOCUS_PS1 — script structure (regression guard for #20) ────────────

describe('WIN_FOCUS_PS1 (script structure, #20 regression guard)', () => {
  it('is wrapped in `& { ... }` so param() receives trailing args', () => {
    // PowerShell `-Command "<script>" arg1 arg2` would otherwise concatenate
    // trailing args to the LAST line, parsing them as positional args to the
    // last cmdlet/method call instead of binding to the script's `param()`.
    expect(WIN_FOCUS_PS1.startsWith('& { ')).toBe(true)
    expect(WIN_FOCUS_PS1.endsWith(' }')).toBe(true)
  })

  it('contains the param() declaration so args bind to named parameters', () => {
    expect(WIN_FOCUS_PS1).toContain('param([Int64]$h, [bool]$bringToTop)')
  })

  it('embeds the inner script body inside the wrap', () => {
    expect(WIN_FOCUS_PS1).toContain(WIN_FOCUS_SCRIPT)
  })
})

// ─── MOCK_WINDOWS shape ──────────────────────────────────────────────────────

describe('MOCK_WINDOWS', () => {
  it('is a non-empty readonly array with the canonical mock window', () => {
    expect(Array.isArray(MOCK_WINDOWS)).toBe(true)
    expect(MOCK_WINDOWS.length).toBeGreaterThan(0)
  })

  it('first window has a non-empty title and a valid pid', () => {
    expect(WIN_A.title.length).toBeGreaterThan(0)
    expect(Number.isInteger(WIN_A.pid)).toBe(true)
    expect(WIN_A.pid).toBeGreaterThan(0)
  })
})

// ─── Tool registration sanity ────────────────────────────────────────────────
//
// We don't re-test the MCP transport here — that's `test/e2e/mcp-lifecycle.test.ts`.
// We only assert that the tools we added show up in ALL_TOOLS and that their
// name/description strings look right. (Avoids a full MCP server round-trip per
// tool assertion.)

describe('da_window_list / da_window_focus registration', () => {
  it('daWindowList is defined and has the expected name', async () => {
    const { daWindowList } = await import('../../src/tools/window-list.js')
    expect(daWindowList.name).toBe('da_window_list')
  })

  it('daWindowFocus is defined and has the expected name', async () => {
    const { daWindowFocus } = await import('../../src/tools/window-focus.js')
    expect(daWindowFocus.name).toBe('da_window_focus')
  })

  it('ALL_TOOLS includes both new tools', async () => {
    const { ALL_TOOLS } = await import('../../src/tools/index.js')
    const names = ALL_TOOLS.map((t) => t.name)
    expect(names).toContain('da_window_list')
    expect(names).toContain('da_window_focus')
  })

  it('daWindowFocus description mentions NOT_FOUND behavior', async () => {
    const { daWindowFocus } = await import('../../src/tools/window-focus.js')
    expect(daWindowFocus.description).toContain('NOT_FOUND')
  })
})

// Suppress "value is never read" hints for the imports we use only for shape
// assertions above.
void WIN_A
void WIN_B
void WIN_C
void SAMPLE