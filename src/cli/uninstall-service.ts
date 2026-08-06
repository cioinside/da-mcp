/**
 * `da-mcp uninstall-service` — stop, disable and remove the OS-specific
 * service definition. Symmetric counterpart to `install-service`.
 *
 * The actual logic lives in `install-service.ts` (`uninstallService`);
 * this module is the thin CLI runner so the dispatch layer has a single
 * import per subcommand.
 */
import { defaultExec } from './exec.js'
import { uninstallService, type InstallServiceOptions, type InstallServiceResult } from './install-service.js'

export interface UninstallServiceOptions extends InstallServiceOptions {}

export function makeUninstallRunner(): (opts: UninstallServiceOptions) => Promise<InstallServiceResult> {
  const exec = defaultExec()
  return (opts) => uninstallService({ ...opts, exec })
}