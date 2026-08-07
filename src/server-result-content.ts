/**
 * Result-to-CallToolResult content mapping.
 *
 * Detects when a tool handler's result carries an image Buffer (e.g. the
 * raw PNG returned by da_screenshot) and emits the appropriate MCP
 * ImageContent block alongside the structured text content. Keeps
 * `structuredContent` unchanged so downstream tool chains can still access
 * raw bytes via the Buffer→number[] normalization.
 *
 * Bug fix for issue #28: da_screenshot previously emitted a single text
 * content block with the PNG bytes serialized as a JSON number array.
 * For a 1920×1080 screenshot that's ~10 KB of `,`-separated integers per
 * capture, and vision-capable clients (Claude / OpenCode / GPT-4o) had
 * no way to reconstruct the image. With this mapper, vision clients get
 * a proper `{type: 'image', data: '<base64>', mimeType: 'image/png'}`
 * block; text-only clients fall back to the metadata JSON.
 */
import { Buffer } from 'node:buffer'
import type { ContentBlock } from '@modelcontextprotocol/server'

/**
 * If `result` is an object with a `buffer` field that is a Buffer, return
 * it. Returns null for any other shape (no buffer, wrong type, primitives).
 */
export function extractImageBuffer(result: unknown): Buffer | null {
  if (result === null || typeof result !== 'object') return null
  const obj = result as Record<string, unknown>
  const buf = obj['buffer']
  return Buffer.isBuffer(buf) ? buf : null
}

/**
 * Detect image MIME type by inspecting the leading magic bytes.
 * Returns null for non-image data or buffers too short to identify.
 *
 * Supported: PNG, JPEG, GIF, WebP. These are the image formats any
 * cross-platform screenshot backend can produce.
 */
export function detectImageMimeType(buf: Buffer): string | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF: 'GIF87a' or 'GIF89a'
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return 'image/gif'
  }
  // WebP: 'RIFF'????'WEBP'
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * Build the `content` array for a CallToolResult, given the tool handler's
 * raw result and its structured (Buffer-normalized) form.
 *
 * When the result carries an image Buffer — and its magic bytes match a
 * recognized format — emit an ImageContent block first so vision-capable
 * clients render the image directly. The text content (second block) is
 * metadata-only: the `buffer` field is stripped so the text stays compact;
 * downstream callers read raw bytes from `structuredContent.buffer`
 * (already a `number[]`).
 *
 * When the result has no buffer, or the buffer is not a recognized image,
 * emit a single text content block (the original v1.0.x behavior).
 */
export function buildResultContent(
  result: unknown,
  structured: Record<string, unknown>,
): ContentBlock[] {
  const imageBuffer = extractImageBuffer(result)
  if (imageBuffer !== null) {
    const mimeType = detectImageMimeType(imageBuffer)
    if (mimeType !== null) {
      const metadata: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(structured)) {
        if (k !== 'buffer') metadata[k] = v
      }
      return [
        { type: 'image', data: imageBuffer.toString('base64'), mimeType },
        { type: 'text', text: JSON.stringify(metadata, undefined, 2) },
      ]
    }
  }
  return [{ type: 'text', text: JSON.stringify(result, undefined, 2) }]
}
