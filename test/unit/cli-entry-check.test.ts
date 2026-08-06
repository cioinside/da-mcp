/**
 * Regression test for the Windows CLI entry-point bug.
 *
 * The original code in src/server-dispatch.ts used:
 *   if (import.meta.url === `file://${process.argv[1]}`) { ... }
 *
 * On Linux/macOS this works because both sides use forward slashes.
 * On Windows, import.meta.url is `file:///C:/foo/bar.js` (forward slashes)
 * while process.argv[1] is `C:\foo\bar.js` (backslashes), so the template
 * literal produces `file://C:\foo\bar.js` — never a valid file URL and
 * never equal to the actual import.meta.url. The CLI then exits silently
 * instead of starting the server.
 *
 * The fix uses `fileURLToPath` to normalize the URL to platform-native
 * form before comparison. These tests verify that round-trip works on
 * native paths and that the original buggy comparison only worked on
 * POSIX (which is why CI on Linux never caught the regression).
 *
 * Note: these tests do NOT actually exercise the live server-dispatch.ts
 * (the comparison is inline, not exported). That is intentional — the
 * subprocess test in test/integration/cli-entry.test.ts is the end-to-end
 * regression catcher. This unit test documents the bug and the invariant
 * the fix relies on.
 */
import { describe, it, expect } from 'vitest'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IS_WIN32 = process.platform === 'win32'

const NATIVE_PATH = IS_WIN32
  ? 'C:\\Users\\foo\\da-mcp\\dist\\server-dispatch.js'
  : '/home/foo/da-mcp/dist/server-dispatch.js'

describe('CLI entry-point equality check — round-trip invariant', () => {
  it('fileURLToPath(pathToFileURL(p)) === p for the native-OS path', () => {
    const url = pathToFileURL(NATIVE_PATH).href
    expect(fileURLToPath(url)).toBe(NATIVE_PATH)
  })
})

describe('CLI entry-point equality check — Windows-specific bug demonstration', () => {
  it.runIf(IS_WIN32)(
    'the OLD broken comparison does NOT match on Windows (bug repro)',
    () => {
      const winPath = 'C:\\Users\\foo\\da-mcp\\dist\\server-dispatch.js'
      const actualUrl = pathToFileURL(winPath).href
      const brokenConcat = `file://${winPath}`
      expect(brokenConcat).not.toBe(actualUrl)
      // Sanity-check what the actual URL looks like on Windows: forward
      // slashes, prefixed with file:///, with %3A-encoded colon.
      expect(actualUrl).toMatch(/^file:\/\/\/[A-Z]:\//)
    },
  )

  it.runIf(!IS_WIN32)(
    'the OLD broken comparison WOULD match on POSIX (why CI missed it)',
    () => {
      const posixPath = '/home/foo/da-mcp/dist/server-dispatch.js'
      const actualUrl = pathToFileURL(posixPath).href
      const brokenConcat = `file://${posixPath}`
      expect(brokenConcat).toBe(actualUrl)
    },
  )
})
