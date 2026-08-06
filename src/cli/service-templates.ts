/**
 * Load and render service definition templates from `scripts/{systemd,launchd,windows}/`.
 *
 * Why filesystem-based templates? Two reasons:
 *   1. Operators read the raw template files when debugging (`cat
 *      scripts/systemd/da-mcp.service`). Templating them inline as TS
 *      template literals would hide them behind a code fence.
 *   2. PowerShell's `New-Service` requires a wrapped binary path with
 *      platform-specific quoting; keeping the launchd plist + systemd
 *      unit + Windows service definition in plain text makes OS-specific
 *      quirks visible in code review.
 *
 * Each template uses `{{key}}` placeholders. `renderTemplate` replaces
 * them with values from the `vars` object. Unknown keys are left as-is
 * so a typo doesn't silently produce a syntactically valid but broken
 * service definition.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DaMcpError } from '../errors.js'

export type ServicePlatform = 'linux' | 'darwin' | 'win32'

export interface ServiceRenderVars {
  readonly projectRoot: string
  readonly nodePath: string
  readonly user: string
  readonly uid: string
  readonly home: string
  readonly transport: 'stdio' | 'http'
  readonly logPath: string
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

export function renderTemplate(template: string, vars: Partial<ServiceRenderVars>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key]
    if (value === undefined) return match
    return value
  })
}

export function loadServiceTemplate(platform: ServicePlatform, projectRoot: string, file: string): string {
  const subdir = platform === 'linux' ? 'systemd' : platform === 'darwin' ? 'launchd' : 'windows'
  const fullPath = resolve(projectRoot, 'scripts', subdir, file)
  try {
    return readFileSync(fullPath, 'utf8')
  } catch (err: unknown) {
    throw new DaMcpError(
      'INTERNAL',
      `Cannot read service template ${fullPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export interface ServiceTargetPath {
  readonly platform: ServicePlatform
  readonly path: string
}

export function resolveServiceTargetPath(platform: ServicePlatform, home: string): ServiceTargetPath {
  switch (platform) {
    case 'linux':
      return { platform, path: join(home, '.config', 'systemd', 'user', 'da-mcp.service') }
    case 'darwin':
      return { platform, path: join(home, 'Library', 'LaunchAgents', 'com.da-mcp.daemon.plist') }
    case 'win32':
      return { platform, path: '' }
  }
}