/**
 * macOS scroll primitive — STUB for issue #13.
 *
 * osascript System Events does NOT expose a direct scroll primitive. The
 * cleanest path is `cliclick` (third-party, `brew install cliclick`); if
 * not available, throw NATIVE_MISSING. Tracked by #19.
 */
function stub(): never {
  throw new Error(
    'macOS scroll is not implemented in #13 — use Windows SEA binary or ' +
      'build from source on Linux. Tracked by issue #19.',
  )
}

export function mouseScrollMac(_dx: number, _dy: number): Promise<void> {
  return Promise.resolve(stub())
}
