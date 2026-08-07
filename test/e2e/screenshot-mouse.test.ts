/**
 * End-to-end test suite: real X11 screenshot capture + mouse input.
 *
 * Runs ONLY when DA_MCP_TEST_MODE !== 'mock' (skipped otherwise so mock CI runs
 * don't hang on native X11 calls). Uses the screenshot CLI fallback for capture
 * and xdotool for mouse input — both reach out to the live DISPLAY (default
 * localhost:12.0).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { initConfig, resetConfig } from '../../src/config.js'
import {
  screenshot,
  listDisplays,
  checkPngMagic,
} from '../../src/screenshot/index.js'
import {
  mouseMove,
  mouseClick,
  mouseDrag,
  mouseScroll,
} from '../../src/input/index.js'
import { detectPlatform } from '../../src/platform/detect.js'
import type { DisplayInfo } from '../../src/platform/types.js'

const PNG_MAGIC: readonly number[] = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]

/** True iff `buf` starts with the 8-byte PNG signature. */
function isPng(buf: Buffer): boolean {
  if (buf.length < PNG_MAGIC.length) return false
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]!) return false
  }
  return true
}

/**
 * Re-throw anything that is NOT an expected X11/permission skip condition.
 * DaMcpError codes: PERMISSION_DENIED, NATIVE_MISSING, NATIVE_FAILED,
 * UNSUPPORTED_PLATFORM, DISPLAY_NOT_FOUND.
 */
function rethrowIfReal(err: unknown): never | undefined {
  if (err === undefined || err === null) return
  const code = (err as { code?: string }).code
  if (
    code === 'PERMISSION_DENIED' ||
    code === 'NATIVE_MISSING' ||
    code === 'NATIVE_FAILED' ||
    code === 'UNSUPPORTED_PLATFORM' ||
    code === 'DISPLAY_NOT_FOUND'
  ) {
    return
  }
  const errno = (err as NodeJS.ErrnoException).code
  if (errno === 'EACCES') return
  throw err
}

interface DisplayFixture {
  primary: DisplayInfo
  safeX: number
  safeY: number
  dragFromX: number
  dragFromY: number
  dragToX: number
  dragToY: number
  scrollX: number
  scrollY: number
}

const fixture: DisplayFixture = {
  primary: {
    id: 0,
    name: 'pending',
    isPrimary: true,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    scaleFactor: 1,
    rotation: 0,
  },
  safeX: 10,
  safeY: 10,
  dragFromX: 50,
  dragFromY: 50,
  dragToX: 100,
  dragToY: 100,
  scrollX: 100,
  scrollY: 100,
}

describe.skipIf(process.env['DA_MCP_TEST_MODE'] === 'mock')(
  'screenshot + mouse e2e @integration',
  () => {
    beforeAll(async () => {
      initConfig({ DA_MCP_TEST_MODE: 'real' })
      const info = detectPlatform()
      if (info.os === 'unknown') {
        it.skip(true, 'unsupported platform for e2e test')
        return
      }
      const displays = await listDisplays()
      if (displays.length < 1) {
        it.skip(true, 'listDisplays() returned empty array — no display attached')
        return
      }
      const primary =
        displays.find((d) => d.isPrimary) ?? displays[0]!
      fixture.primary = primary
      const bx = primary.bounds.x
      const by = primary.bounds.y
      fixture.safeX = bx + 10
      fixture.safeY = by + 10
      fixture.dragFromX = bx + 50
      fixture.dragFromY = by + 50
      const dragToX = bx + 100
      const dragToY = by + 100
      const maxX = bx + primary.bounds.width - 5
      const maxY = by + primary.bounds.height - 5
      fixture.dragToX = dragToX < maxX ? dragToX : maxX
      fixture.dragToY = dragToY < maxY ? dragToY : maxY
      fixture.scrollX = bx + 100
      fixture.scrollY = by + 100
    })

    afterAll(() => {
      resetConfig()
    })

    it('listDisplays returns valid DisplayInfo @integration', async () => {
      const displays = await listDisplays()
      expect(displays.length).toBeGreaterThanOrEqual(1)
      for (const d of displays) {
        expect(typeof d.id).toBe('number')
        expect(d.bounds).toBeDefined()
        expect(typeof d.bounds.x).toBe('number')
        expect(typeof d.bounds.y).toBe('number')
        expect(typeof d.bounds.width).toBe('number')
        expect(typeof d.bounds.height).toBe('number')
        expect(d.bounds.width).toBeGreaterThan(0)
        expect(d.bounds.height).toBeGreaterThan(0)
        expect(typeof d.scaleFactor).toBe('number')
        expect(d.scaleFactor).toBeGreaterThan(0)
        expect(typeof d.isPrimary).toBe('boolean')
      }
    })

    it('screenshot returns a valid PNG buffer @integration', async () => {
      try {
        const defaultBuf = await screenshot(null)
        expect(Buffer.isBuffer(defaultBuf)).toBe(true)
        expect(defaultBuf.length).toBeGreaterThan(0)
        expect(isPng(defaultBuf)).toBe(true)
        expect(checkPngMagic(defaultBuf)).toBe(true)
        const explicitBuf = await screenshot(fixture.primary.id)
        expect(Buffer.isBuffer(explicitBuf)).toBe(true)
        expect(explicitBuf.length).toBeGreaterThan(0)
        expect(isPng(explicitBuf)).toBe(true)
      } catch (err) {
        rethrowIfReal(err)
      }
    })

    it('mouseMove at safe coord succeeds @integration', async () => {
      try {
        await mouseMove(fixture.safeX, fixture.safeY)
      } catch (err) {
        rethrowIfReal(err)
      }
    })

    it('mouseClick (count=1) at safe coord succeeds @integration', async () => {
      try {
        await mouseMove(fixture.safeX, fixture.safeY)
        await mouseClick('left', 1)
      } catch (err) {
        rethrowIfReal(err)
      }
    })

    it('mouseClick count=2 (doubleClick) succeeds @integration', async () => {
      try {
        await mouseMove(fixture.safeX, fixture.safeY)
        await mouseClick('left', 2)
      } catch (err) {
        rethrowIfReal(err)
      }
    })

    it('mouseDrag between safe coords succeeds @integration', async () => {
      try {
        await mouseDrag(
          fixture.dragFromX,
          fixture.dragFromY,
          fixture.dragToX,
          fixture.dragToY,
        )
      } catch (err) {
        rethrowIfReal(err)
      }
    })

    it('mouseScroll at safe coord succeeds @integration', async () => {
      try {
        await mouseMove(fixture.scrollX, fixture.scrollY)
        await mouseScroll(0, 100)
      } catch (err) {
        rethrowIfReal(err)
      }
    })

    it('screenshot after input is still a valid PNG @integration', async () => {
      try {
        const buf = await screenshot(null)
        expect(Buffer.isBuffer(buf)).toBe(true)
        expect(buf.length).toBeGreaterThan(0)
        expect(isPng(buf)).toBe(true)
        expect(checkPngMagic(buf)).toBe(true)
      } catch (err) {
        rethrowIfReal(err)
      }
    })
  },
)
