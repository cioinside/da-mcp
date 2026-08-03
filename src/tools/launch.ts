/**
 * da_launch — launch a program via src/launch/launch.ts.
 *
 * argv[0] is the program name (resolved via PATH or used as a path when it
 * contains a separator). Returns the JSON-serializable parts of SpawnHandle:
 * pid (number | null) and killed (boolean). The full handle's lifecycle methods
 * are not exposed via MCP — the server can re-create a handle if needed.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { launchProgram } from '../launch/launch.js'

const schema = z.object({
  argv: z.array(z.string().min(1)).min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(0).optional(),
  detached: z.boolean().optional(),
})

export const daLaunch = defineTool({
  name: 'da_launch',
  description:
    'Launch a program by name or absolute path. argv[0] is required. cwd, env, timeoutMs, and detached are optional.',
  inputSchema: schema,
  handler: async (input) => {
    const opts: {
      cwd?: string
      env?: Record<string, string>
      timeoutMs?: number
      detached?: boolean
    } = {}
    if (input.cwd !== undefined) opts.cwd = input.cwd
    if (input.env !== undefined) opts.env = input.env
    if (input.timeoutMs !== undefined) opts.timeoutMs = input.timeoutMs
    if (input.detached !== undefined) opts.detached = input.detached
    const handle = await launchProgram(input.argv, opts)
    return { pid: handle.pid, killed: handle.killed }
  },
})