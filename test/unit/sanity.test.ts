import { describe, it, expect } from 'vitest'
import {
  SERVER_NAME,
  SERVER_VERSION,
  PROTOCOL_VERSION,
} from '../../src/version.js'

describe('sanity', () => {
  it('exports server identity', () => {
    expect(SERVER_NAME).toBe('da-mcp')
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(PROTOCOL_VERSION).toBe('2026-07-28')
  })
})