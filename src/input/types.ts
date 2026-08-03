/**
 * Public types for the input subsystem.
 *
 * Re-exports the shared semantic primitives (MouseButton, Modifier, KeyName)
 * from src/platform/types.ts so callers that import from src/input/* don't
 * need to know the platform layer's internal layout.
 *
 * Option bags below are per-operation configuration knobs. Defaults match
 * the PlatformAdapter contract in src/platform/types.ts.
 */

export type { MouseButton, Modifier, KeyName } from '../platform/types.js'

/** Options accepted by mouseMove(). */
export interface MouseOptions {
  /** Duration of the move in ms. Linux/X11 only; ignored elsewhere. */
  durationMs?: number
}

/** Options accepted by keyTap(). */
export interface KeyOptions {
  /** ms to hold the key down. 0 = tap. When combined with modifiers, falls back to a plain tap. */
  holdMs?: number
}

/** Options accepted by typeText(). */
export interface TypeOptions {
  /** ms between characters. 0 = no delay. Default 0. */
  perCharDelayMs?: number
}

/** Options accepted by mouseScroll(). */
export interface ScrollOptions {
  /** Pixel granularity. Default 1 (one click). */
  stepPx?: number
}
