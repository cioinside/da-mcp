/**
 * Auth-layer types for da-mcp HTTP transport.
 *
 * Kept separate from token.ts so that the HTTP layer can reference the
 * AuthError signal without a circular import back into the token helpers.
 * AuthError is a plain Error subclass (NOT a DaMcpError) on purpose: the
 * 401 mapping happens at the HTTP boundary, not at the tool boundary.
 */

export interface TokenStorageOptions {
  /**
   * Override the resolved token file path. When unset, the token lives at
   * the OS-specific default (see `getTokenPath`).
   */
  tokenPath?: string
  /**
   * Number of random bytes to read for `generateToken`. 32 bytes → 256
   * bits of entropy after base64url encoding.
   */
  tokenBytes?: number
}

/**
 * Signals a token mismatch at the HTTP boundary. Carries no `code` property
 * — the HTTP layer is the only code that owns the 401 mapping.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}
