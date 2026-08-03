/**
 * Pure PNG helpers — mock fixture, magic-byte validation, mock-mode flag.
 *
 * Lives apart from backends.ts because these helpers are pure functions of
 * the buffer (no I/O, no native bindings). Keeping them separate means a
 * reviewer can audit "what counts as a valid PNG" in one file.
 */
import { Buffer } from 'node:buffer'
import { DaMcpError } from '../errors.js'
import { getConfig } from '../config.js'
import type { DisplayInfo } from '../platform/types.js'

/** First 8 bytes of every PNG file (signature). */
const PNG_MAGIC: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The deterministic mock-mode fixture (1920x1080, isPrimary=true). */
export const MOCK_DISPLAY: DisplayInfo = {
  id: 0,
  name: 'mock',
  isPrimary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  rotation: 0,
}

export function isMockMode(): boolean {
  try {
    if (getConfig().testMode === 'mock') return true
  } catch {
    // getConfig throws before initConfig runs; env is the only signal then.
  }
  return process.env['DA_MCP_TEST_MODE'] === 'mock'
}

/** Returns true iff `buf` starts with the 8-byte PNG signature. */
export function checkPngMagic(buf: Buffer): boolean {
  if (buf.length < PNG_MAGIC.length) return false
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) {
      return false
    }
  }
  return true
}

/** Throws DaMcpError('SCREENSHOT_EMPTY') when `buf` is empty or not PNG. */
export function validatePngBuffer(buf: Buffer): void {
  if (buf.length === 0 || !checkPngMagic(buf)) {
    throw new DaMcpError(
      'SCREENSHOT_EMPTY',
      `Screenshot buffer invalid (length=${buf.length})`,
    )
  }
}

/** Return an 8-byte buffer holding the PNG magic. Used only in mock mode. */
export function mockPngBuffer(): Buffer {
  return Buffer.from(PNG_MAGIC)
}