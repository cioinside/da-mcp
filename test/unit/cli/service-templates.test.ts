import { describe, it, expect } from 'vitest'
import { renderTemplate, loadServiceTemplate, resolveServiceTargetPath } from '../../../src/cli/service-templates.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function mkProject(): string {
  const root = join(tmpdir(), `da-mcp-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(root, 'scripts', 'systemd'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'launchd'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true })
  return root
}

describe('renderTemplate', () => {
  it('replaces {{key}} placeholders with values', () => {
    const out = renderTemplate('Hello {{name}}!', { name: 'world' })
    expect(out).toBe('Hello world!')
  })

  it('leaves unknown placeholders untouched', () => {
    const out = renderTemplate('{{known}} {{unknown}}', { known: 'kn' })
    expect(out).toBe('kn {{unknown}}')
  })

  it('supports multiple identical placeholders', () => {
    const out = renderTemplate('{{x}} {{x}}', { x: 'A' })
    expect(out).toBe('A A')
  })

  it('returns the template unchanged when no placeholders are present', () => {
    expect(renderTemplate('no vars here', { x: 'y' })).toBe('no vars here')
  })

  it('handles values containing braces literally', () => {
    const out = renderTemplate('{{a}}', { a: '{b}' })
    expect(out).toBe('{b}')
  })
})

describe('loadServiceTemplate', () => {
  it('reads a template from scripts/{systemd,launchd,windows}/', () => {
    const root = mkProject()
    writeFileSync(join(root, 'scripts', 'systemd', 'da-mcp.service'), 'CONTENT')
    expect(loadServiceTemplate('linux', root, 'da-mcp.service')).toBe('CONTENT')
    writeFileSync(join(root, 'scripts', 'launchd', 'com.da-mcp.daemon.plist'), 'PLIST')
    expect(loadServiceTemplate('darwin', root, 'com.da-mcp.daemon.plist')).toBe('PLIST')
  })

  it('throws DaMcpError(INTERNAL) when the template file is missing', () => {
    const root = mkProject()
    expect(() => loadServiceTemplate('linux', root, 'missing.service')).toThrow(/Cannot read service template/)
  })
})

describe('resolveServiceTargetPath', () => {
  it('returns the Linux user unit path', () => {
    const r = resolveServiceTargetPath('linux', '/home/alice')
    expect(r.path).toBe('/home/alice/.config/systemd/user/da-mcp.service')
  })

  it('returns the macOS LaunchAgent path', () => {
    const r = resolveServiceTargetPath('darwin', '/Users/alice')
    expect(r.path).toBe('/Users/alice/Library/LaunchAgents/com.da-mcp.daemon.plist')
  })

  it('returns empty path for Windows (SCM-registered, not file-based)', () => {
    const r = resolveServiceTargetPath('win32', 'C:\\Users\\alice')
    expect(r.path).toBe('')
  })
})