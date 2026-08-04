/**
 * Auth-layer public surface.
 * Consumers import from here, not from per-file.
 */
export { AuthError, type TokenStorageOptions } from './types.js'
export {
  generateToken,
  getTokenPath,
  loadToken,
  loadOrCreateToken,
  regenerateToken,
  saveToken,
  verifyToken,
  getServerUrl,
} from './token.js'
