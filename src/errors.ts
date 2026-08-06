/**
 * Typed error envelope for the da-mcp server.
 *
 * Every module throws DaMcpError at the tool boundary. The MCP tool layer
 * catches and calls toMcpErrorContent() to produce the protocol-level error shape.
 *
 * Adding a new ErrorCode:
 *   1. Add to ErrorCode union above.
 *   2. Add a row to ERROR_CODE_MESSAGES.
 *   3. Add a test case in test/unit/errors.test.ts.
 *   4. Bump DA_MCP_ERROR_SCHEMA_VERSION in src/version.ts (handled in T3.2).
 */

// Canonical, machine-readable error codes.
// Keep this union SHORT and ADDITIVE; new codes require a JSON-Schema bump.
export type ErrorCode =
  | 'OUT_OF_BOUNDS'            // x/y outside any display
  | 'DISPLAY_NOT_FOUND'        // display_id not in listDisplays()
  | 'NATIVE_MISSING'           // required native binary not installed (e.g. tesseract missing)
  | 'NATIVE_FAILED'            // native call returned non-zero exit / stderr
  | 'ENOENT'                   // program not found on PATH
  | 'PERMISSION_DENIED'        // permission to capture screen / inject input denied
  | 'SHELL_INJECTION_DETECTED' // input contains shell metacharacters
  | 'INPUT_TOO_LARGE'          // text > 64 KB
  | 'OCR_FAILED'               // tesseract returned no usable words or process failed
  | 'SCREENSHOT_EMPTY'         // screenshot returned black/all-zero pixels
  | 'UNSUPPORTED_PLATFORM'     // OS+display combo not implemented
  | 'PLATFORM_INIT_FAILED'     // detectPlatform() threw
  | 'INVALID_ARGUMENT'         // schema validation failed (rare; Zod catches most)
  | 'INTERNAL'                 // unexpected — should not happen
  | 'NOT_FOUND'                // query returned no matching resource (e.g. window title substring matched no visible window)

// Stable, human-readable mapping for logs and MCP error text.
export const ERROR_CODE_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  OUT_OF_BOUNDS: 'Coordinates are outside any connected display',
  DISPLAY_NOT_FOUND: 'No display matches the requested displayId',
  NATIVE_MISSING: 'A required native binary is missing',
  NATIVE_FAILED: 'A native subprocess returned a non-zero status',
  ENOENT: 'Program not found on PATH',
  PERMISSION_DENIED: 'Permission denied by the OS (screen capture / input injection requires user consent)',
  SHELL_INJECTION_DETECTED: 'Input contains shell metacharacters',
  INPUT_TOO_LARGE: 'Input exceeds the maximum size',
  OCR_FAILED: 'OCR produced no recognizable text',
  SCREENSHOT_EMPTY: 'Screenshot returned an empty image',
  UNSUPPORTED_PLATFORM: 'This OS / display-server combination is not supported',
  PLATFORM_INIT_FAILED: 'Platform initialization failed',
  INVALID_ARGUMENT: 'Invalid argument',
  INTERNAL: 'Internal server error',
  NOT_FOUND: 'No matching resource found',
}

// Single error class used by all modules.
// Includes: code (machine-readable), message (user-facing summary), cause (preserves stack).
export class DaMcpError extends Error {
  readonly code: ErrorCode
  override readonly cause?: unknown

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'DaMcpError'
    this.code = code
    this.cause = cause
  }

  // Type guard for narrowing `unknown` catches to DaMcpError.
  static is(value: unknown): value is DaMcpError {
    return value instanceof DaMcpError
  }

  // JSON-serializable form for structured logging.
  toJSON(): { name: string; code: ErrorCode; message: string; cause?: unknown } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause,
    }
  }
}

// Helper: turn any thrown value (Error, DaMcpError, string, anything) into a DaMcpError.
// If value is already DaMcpError, returns it unchanged.
export function toDaMcpError(value: unknown, fallbackCode: ErrorCode = 'INTERNAL'): DaMcpError {
  if (DaMcpError.is(value)) return value
  if (value instanceof Error) return new DaMcpError(fallbackCode, value.message, value)
  if (typeof value === 'string') return new DaMcpError(fallbackCode, value)
  return new DaMcpError(fallbackCode, String(value), value)
}

// Helper: turn a DaMcpError into the exact MCP CallToolResult shape.
//   { isError: true, content: [{ type: 'text', text: 'CODE: message' }] }
// For NON-DaMcpError inputs, wraps via toDaMcpError first.
export function toMcpErrorContent(
  value: unknown,
): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  const err = toDaMcpError(value)
  return {
    isError: true,
    content: [{ type: 'text', text: `${err.code}: ${err.message}` }],
  }
}
