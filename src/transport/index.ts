/**
 * Transport-layer public surface.
 * Consumers import from here, not from per-file.
 */
export {
  startHttpServer,
  type HttpServerHandle,
  type HttpServerOptions,
} from './http.js'
