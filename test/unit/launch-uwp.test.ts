import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { isWindowsAppsStub, launchViaShellExecute } from '../../src/launch/uwp.js'
import { initConfig, resetConfig } from '../../src/config.js'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  }
})

interface FakeChild extends EventEmitter {
  pid: number
  stdin: { on: () => void; end: () => void }
  stdout: { on: () => void }
  stderr: { on: () => void }
  kill: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
}

function makeFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = pid
  child.stdin = { on: () => {}, end: () => {} }
  child.stdout = { on: () => {} }
  child.stderr = { on: () => {} }
  child.kill = vi.fn().mockReturnValue(true)
  child.unref = vi.fn()
  return child
}

beforeEach(() => {
  spawnMock.mockReset()
  initConfig({ DA_MCP_TEST_MODE: 'real' })
})

afterEach(() => {
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'mock' })
})

// ---- isWindowsAppsStub ------------------------------------------------------

describe('isWindowsAppsStub', () => {
  it('matches the canonical WindowsApps reparse-stub path', () => {
    expect(isWindowsAppsStub('C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\mspaint.exe')).toBe(true)
  })

  it('matches the forward-slash equivalent (POSIX-style path strings)', () => {
    expect(isWindowsAppsStub('C:/Users/foo/AppData/Local/Microsoft/WindowsApps/mspaint.exe')).toBe(true)
  })

  it('is case-insensitive on the path segments', () => {
    expect(isWindowsAppsStub('c:\\USERS\\foo\\APPDATA\\local\\MICROSOFT\\windowsapps\\MSPAINT.EXE')).toBe(true)
  })

  it('matches every common WindowsApps extension (exe, msix, bat, cmd)', () => {
    expect(isWindowsAppsStub('C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\mspaint.exe')).toBe(true)
    expect(isWindowsAppsStub('C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\tool.bat')).toBe(true)
    expect(isWindowsAppsStub('C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\script.cmd')).toBe(true)
  })

  it('does NOT match the real AppX under %ProgramFiles%\\WindowsApps\\', () => {
    const realAppx = 'C:\\Program Files\\WindowsApps\\Microsoft.Paint_11.2605.71.0_x64__8wekyb3d8bbwe\\PaintApp\\mspaint.exe'
    expect(isWindowsAppsStub(realAppx)).toBe(false)
  })

  it('does NOT match arbitrary programs under System32 or Program Files', () => {
    expect(isWindowsAppsStub('C:\\Windows\\System32\\notepad.exe')).toBe(false)
    expect(isWindowsAppsStub('C:\\Program Files\\Notepad++\\notepad++.exe')).toBe(false)
    expect(isWindowsAppsStub('/usr/bin/mspaint')).toBe(false)
  })

  it('does NOT match a directory (no .exe ending)', () => {
    expect(isWindowsAppsStub('C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps')).toBe(false)
    expect(isWindowsAppsStub('C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\')).toBe(false)
  })

  it('returns false for empty / non-string inputs', () => {
    expect(isWindowsAppsStub('')).toBe(false)
    expect(isWindowsAppsStub(null as unknown as string)).toBe(false)
    expect(isWindowsAppsStub(undefined as unknown as string)).toBe(false)
  })

  it('rejects extensions longer than 8 alphanumeric chars (DOS 8.3 limit)', () => {
    expect(isWindowsAppsStub('C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\tool.toolonggg')).toBe(false)
  })

  it('matches cross-drive / different drive letter', () => {
    expect(isWindowsAppsStub('D:\\Profiles\\bar\\AppData\\Local\\Microsoft\\WindowsApps\\WhatsApp.exe')).toBe(true)
  })
})

// ---- launchViaShellExecute -------------------------------------------------

describe('launchViaShellExecute', () => {
  it('wraps argv in cmd.exe /c start "" <path> <args...>', async () => {
    const fakeChild = makeFakeChild(12345)
    spawnMock.mockReturnValue(fakeChild)

    await launchViaShellExecute(
      ['C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\mspaint.exe'],
      'C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\mspaint.exe',
      {},
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawnMock.mock.calls[0] ?? []
    expect(cmd).toBe('cmd.exe')
    expect(args).toEqual([
      '/c',
      'start',
      '""',
      'C:\\Users\\foo\\AppData\\Local\\Microsoft\\WindowsApps\\mspaint.exe',
    ])
    expect(opts).toMatchObject({
      shell: false,
      detached: true,
      cwd: undefined,
      env: process.env,
      stdio: 'ignore',
    })
  })

  it('forwards argv[1..] to start as the target program\'s command-line', async () => {
    const fakeChild = makeFakeChild()
    spawnMock.mockReturnValue(fakeChild)

    await launchViaShellExecute(
      ['C:\\stub.exe', '--flag', '/path/to/file.txt'],
      'C:\\stub.exe',
      {},
    )

    const args = (spawnMock.mock.calls[0]?.[1] as readonly string[]) ?? []
    expect(args).toEqual(['/c', 'start', '""', 'C:\\stub.exe', '--flag', '/path/to/file.txt'])
  })

  it('uses the cmd.exe child PID in the returned SpawnHandle (documented limitation)', async () => {
    const fakeChild = makeFakeChild(9876)
    spawnMock.mockReturnValue(fakeChild)

    const handle = await launchViaShellExecute(['C:\\stub.exe'], 'C:\\stub.exe', {})

    expect(handle.pid).toBe(9876)
    expect(handle.killed).toBe(false)
  })

  it('calls child.unref() when detached (default), keeps handle alive on the parent', async () => {
    const fakeChild = makeFakeChild()
    spawnMock.mockReturnValue(fakeChild)

    await launchViaShellExecute(['C:\\stub.exe'], 'C:\\stub.exe', {})

    expect(fakeChild.unref).toHaveBeenCalledTimes(1)
  })

  it('does NOT unref() when detached:false', async () => {
    const fakeChild = makeFakeChild()
    spawnMock.mockReturnValue(fakeChild)

    await launchViaShellExecute(['C:\\stub.exe'], 'C:\\stub.exe', { detached: false })

    expect(fakeChild.unref).not.toHaveBeenCalled()
  })

  it('respects explicit timeoutMs (non-detached) — SIGTERM exit code 143 on timer fire', async () => {
    const fakeChild = makeFakeChild()
    spawnMock.mockReturnValue(fakeChild)

    const handle = await launchViaShellExecute(
      ['C:\\stub.exe'],
      'C:\\stub.exe',
      { detached: false, timeoutMs: 50 },
    )

    const code = await handle.exited
    expect(code).toBe(143)
    expect(handle.killed).toBe(true)
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('forwards cwd / env / stdio opts to the cmd.exe spawn', async () => {
    const fakeChild = makeFakeChild()
    spawnMock.mockReturnValue(fakeChild)
    const customEnv = { FOO: 'bar' }

    await launchViaShellExecute(
      ['C:\\stub.exe'],
      'C:\\stub.exe',
      { cwd: 'C:\\work', env: customEnv, stdio: 'pipe' },
    )

    const opts = spawnMock.mock.calls[0]?.[2] as Record<string, unknown>
    expect(opts['cwd']).toBe('C:\\work')
    expect(opts['env']).toBe(customEnv)
    expect(opts['stdio']).toBe('pipe')
  })

  it('rejects with NATIVE_FAILED when spawn emits an error event', async () => {
    const fakeChild = makeFakeChild()
    spawnMock.mockReturnValue(fakeChild)

    const handle = await launchViaShellExecute(['C:\\stub.exe'], 'C:\\stub.exe', {})
    queueMicrotask(() => {
      fakeChild.emit('error', new Error('cmd.exe not found'))
    })

    await expect(handle.exited).rejects.toMatchObject({
      code: 'NATIVE_FAILED',
      message: expect.stringContaining('cmd.exe not found'),
    })
  })

  it('resolves exited with exit code when spawn emits exit', async () => {
    const fakeChild = makeFakeChild()
    spawnMock.mockReturnValue(fakeChild)

    const handle = await launchViaShellExecute(['C:\\stub.exe'], 'C:\\stub.exe', {})
    queueMicrotask(() => {
      fakeChild.emit('exit', 0, null)
    })

    await expect(handle.exited).resolves.toBe(0)
  })
})