/**
 * `da-mcp install-tesseract` — install the Tesseract OCR CLI on Windows so
 * `da_ocr` can use the fast CLI backend instead of the bundled WASM fallback.
 *
 * Windows-only in v1.0.13 (Linux/macOS users install via their package
 * manager directly). Three package-manager paths, in order of preference:
 *
 *   1. winget  (`winget install --id UB-Mannheim.TesseractOCR ...`)
 *   2. choco   (`choco install tesseract ...`)
 *   3. error   — neither found, fall back to docs
 *
 * Self-elevation: if the current process is NOT admin, we re-launch via
 * `Start-Process -Verb RunAs` and return immediately. The elevated
 * instance runs the same subcommand, detects it IS admin, and proceeds.
 * This avoids surprising UAC prompts for already-elevated shells.
 *
 * All subprocess calls go through the injected `ExecFn` (or the
 * production `defaultExec()`) so tests can mock every step without
 * touching real winget/choco/PowerShell.
 */
import { DaMcpError } from '../errors.js'
import { defaultExec, type ExecFn } from './exec.js'

export interface InstallTesseractOptions {
  readonly exec: ExecFn
  readonly log: (msg: string) => void
  readonly platform: NodeJS.Platform
  readonly execPath: string
  readonly extraArgs: readonly string[]
  readonly isAdmin?: () => Promise<boolean>
  readonly hasTesseract?: () => Promise<boolean>
  readonly hasWinget?: () => Promise<boolean>
  readonly hasChoco?: () => Promise<boolean>
  readonly relaunchElevated?: (args: readonly string[]) => Promise<void>
}

export interface InstallTesseractResult {
  readonly installed: boolean
  readonly alreadyInstalled: boolean
  readonly elevated: boolean
  readonly packageManager: 'winget' | 'choco' | null
  readonly tesseractPath: string | null
}

export class InstallTesseractError extends DaMcpError {
  constructor(code: 'UNSUPPORTED_PLATFORM' | 'NATIVE_MISSING' | 'NATIVE_FAILED', message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

const TESSERACT_WINGET_ID = 'UB-Mannheim.TesseractOCR'
const TESSERACT_CHOCO_ID = 'tesseract'

async function defaultIsAdmin(exec: ExecFn): Promise<boolean> {
  const script =
    'if ([Security.Principal.WindowsPrincipal]' +
    '[Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(' +
    '[Security.Principal.WindowsBuiltInRole]::Administrator) { exit 0 } else { exit 1 }'
  const result = await exec('powershell', ['-NoProfile', '-Command', script], { throwOnError: false })
  return result.code === 0
}

async function defaultHasTesseract(exec: ExecFn): Promise<boolean> {
  const result = await exec('tesseract', ['--version'], { throwOnError: false })
  return result.code === 0
}

async function defaultHasWinget(exec: ExecFn): Promise<boolean> {
  const result = await exec('winget', ['--version'], { throwOnError: false })
  return result.code === 0
}

async function defaultHasChoco(exec: ExecFn): Promise<boolean> {
  const result = await exec('choco', ['--version'], { throwOnError: false })
  return result.code === 0
}

async function defaultRelaunchElevated(
  exec: ExecFn,
  execPath: string,
  args: readonly string[],
): Promise<void> {
  const psArgList = args.map((a) => `'${a.replaceAll("'", "''")}'`).join(',')
  const script = `Start-Process -FilePath '${execPath.replaceAll("'", "''")}' -ArgumentList ${psArgList} -Verb RunAs -Wait`
  await exec('powershell', ['-NoProfile', '-Command', script], { throwOnError: true })
}

export async function runInstallTesseract(opts: InstallTesseractOptions): Promise<InstallTesseractResult> {
  if (opts.platform !== 'win32') {
    throw new InstallTesseractError(
      'UNSUPPORTED_PLATFORM',
      `install-tesseract is currently Windows-only. On ${opts.platform}, install tesseract via your package manager (apt/brew/dnf/pacman).`,
    )
  }

  const isAdmin = opts.isAdmin ?? (() => defaultIsAdmin(opts.exec))
  const hasTesseract = opts.hasTesseract ?? (() => defaultHasTesseract(opts.exec))
  const hasWinget = opts.hasWinget ?? (() => defaultHasWinget(opts.exec))
  const hasChoco = opts.hasChoco ?? (() => defaultHasChoco(opts.exec))
  const relaunchElevated = opts.relaunchElevated ?? ((args) => defaultRelaunchElevated(opts.exec, opts.execPath, args))

  if (await hasTesseract()) {
    opts.log('tesseract already installed.')
    return { installed: true, alreadyInstalled: true, elevated: false, packageManager: null, tesseractPath: 'tesseract' }
  }

  if (!(await isAdmin())) {
    opts.log('current process is not elevated; re-launching via UAC...')
    await relaunchElevated(['install-tesseract', ...opts.extraArgs])
    return { installed: false, alreadyInstalled: false, elevated: true, packageManager: null, tesseractPath: null }
  }

  if (await hasWinget()) {
    opts.log('installing tesseract via winget...')
    const res = await opts.exec(
      'winget',
      [
        'install',
        '--id', TESSERACT_WINGET_ID,
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--silent',
      ],
      { throwOnError: false },
    )
    if (res.code !== 0) {
      throw new InstallTesseractError('NATIVE_FAILED', `winget install failed (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`)
    }
    return { installed: true, alreadyInstalled: false, elevated: false, packageManager: 'winget', tesseractPath: 'tesseract' }
  }

  if (await hasChoco()) {
    opts.log('installing tesseract via choco...')
    const res = await opts.exec(
      'choco',
      ['install', TESSERACT_CHOCO_ID, '-y', '--no-progress'],
      { throwOnError: false },
    )
    if (res.code !== 0) {
      throw new InstallTesseractError('NATIVE_FAILED', `choco install failed (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`)
    }
    return { installed: true, alreadyInstalled: false, elevated: false, packageManager: 'choco', tesseractPath: 'tesseract' }
  }

  throw new InstallTesseractError(
    'NATIVE_MISSING',
    'Neither winget nor chocolatey found on PATH. Install Tesseract manually from https://github.com/UB-Mannheim/tesseract.',
  )
}

export function makeInstallTesseractRunner(): (opts: InstallTesseractOptions) => Promise<InstallTesseractResult> {
  const exec = defaultExec()
  return (opts) => runInstallTesseract({ ...opts, exec })
}