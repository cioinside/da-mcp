import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import {
  buildResultContent,
  detectImageMimeType,
  extractImageBuffer,
} from '../../src/server-result-content.js'

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78,
  0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const GIF_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

describe('extractImageBuffer', () => {
  it('returns the buffer when result.buffer is a Buffer', () => {
    expect(extractImageBuffer({ buffer: PNG_1X1, length: PNG_1X1.length })).toBe(PNG_1X1)
  })

  it('returns null when result has no buffer field', () => {
    expect(extractImageBuffer({ length: 8 })).toBeNull()
  })

  it('returns null when result.buffer is not a Buffer', () => {
    expect(extractImageBuffer({ buffer: [0x89, 0x50] })).toBeNull()
    expect(extractImageBuffer({ buffer: 'string' })).toBeNull()
    expect(extractImageBuffer({ buffer: null })).toBeNull()
  })

  it('returns null for non-object inputs', () => {
    expect(extractImageBuffer(null)).toBeNull()
    expect(extractImageBuffer('string')).toBeNull()
    expect(extractImageBuffer(42)).toBeNull()
    expect(extractImageBuffer([PNG_1X1])).toBeNull()
  })
})

describe('detectImageMimeType', () => {
  it('detects PNG by 8-byte magic', () => {
    expect(detectImageMimeType(PNG_1X1)).toBe('image/png')
    expect(
      detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png')
  })

  it('detects JPEG by 3-byte magic', () => {
    expect(detectImageMimeType(JPEG_HEADER)).toBe('image/jpeg')
  })

  it('detects GIF by 6-byte magic', () => {
    expect(detectImageMimeType(GIF_HEADER)).toBe('image/gif')
  })

  it('detects WebP by RIFF+WEBP magic', () => {
    expect(detectImageMimeType(WEBP_HEADER)).toBe('image/webp')
  })

  it('returns null for unknown or too-short data', () => {
    expect(detectImageMimeType(Buffer.alloc(0))).toBeNull()
    expect(detectImageMimeType(Buffer.from([0x00]))).toBeNull()
    expect(detectImageMimeType(Buffer.from('plain text'))).toBeNull()
  })
})

describe('buildResultContent', () => {
  it('emits ImageContent + metadata text when result has a PNG buffer', () => {
    const result = { buffer: PNG_1X1, length: PNG_1X1.length }
    const structured = { buffer: Array.from(PNG_1X1), length: PNG_1X1.length }
    const content = buildResultContent(result, structured)
    expect(content).toHaveLength(2)
    const image = content[0] as { type: string; data: string; mimeType: string }
    expect(image.type).toBe('image')
    expect(image.mimeType).toBe('image/png')
    expect(typeof image.data).toBe('string')
    expect(Buffer.from(image.data, 'base64').equals(PNG_1X1)).toBe(true)
    const text = content[1] as { type: string; text: string }
    expect(text.type).toBe('text')
    const meta = JSON.parse(text.text) as Record<string, unknown>
    expect(meta['buffer']).toBeUndefined()
    expect(meta['length']).toBe(PNG_1X1.length)
  })

  it('emits only text content when result has no buffer field', () => {
    const result = { foo: 'bar', count: 42 }
    const structured = { foo: 'bar', count: 42 }
    const content = buildResultContent(result, structured)
    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({ type: 'text' })
  })

  it('falls back to text content when buffer has no recognized image magic', () => {
    const fakeBuffer = Buffer.from('not an image at all')
    const result = { buffer: fakeBuffer, length: fakeBuffer.length }
    const structured = { buffer: Array.from(fakeBuffer), length: fakeBuffer.length }
    const content = buildResultContent(result, structured)
    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({ type: 'text' })
  })

  it('emits image content for JPEG buffers too', () => {
    const result = { buffer: JPEG_HEADER, length: JPEG_HEADER.length }
    const structured = { buffer: Array.from(JPEG_HEADER), length: JPEG_HEADER.length }
    const content = buildResultContent(result, structured)
    expect(content).toHaveLength(2)
    expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
  })
})
