/**
 * Types for the launch subsystem.
 *
 * Spawn / spawn-handle shapes are owned by `src/platform/types.ts` — the launch
 * subsystem re-exports them so callers can `import { SpawnHandle } from
 * '../launch/types.js'` without reaching into the platform layer.
 *
 * `LaunchOpts` extends `SpawnOpts` with a single per-process timeout override
 * that defaults to `getConfig().subprocessTimeoutMs` at call time.
 */

import type { SpawnOpts, SpawnHandle } from '../platform/types.js'

export type { SpawnOpts, SpawnHandle }

export interface LaunchOpts extends SpawnOpts {
  /** Override the per-process subprocess timeout (ms). Default: getConfig().subprocessTimeoutMs. */
  timeoutMs?: number
}
