/**
 * MCP tool definition contract.
 *
 * Each tool exposes:
 *   - name:        stable identifier (must start with 'da_').
 *   - description: human-readable; shown to the LLM during tool discovery.
 *   - inputSchema: Zod schema (v4). Used for both validation and JSON-Schema export.
 *   - handler:     async function that takes a parsed input and returns a result
 *                  or throws a DaMcpError.
 *
 * The defineTool() helper is a typed identity function: it preserves the inferred
 * input type so callers can write `tool.handler(input)` without an extra cast.
 */
import type { ZodTypeAny, z } from 'zod'

export interface McpToolDefinition<S extends ZodTypeAny = ZodTypeAny> {
  readonly name: string
  readonly description: string
  readonly inputSchema: S
  readonly handler: (input: z.infer<S>) => Promise<unknown>
}

export function defineTool<S extends ZodTypeAny>(
  def: McpToolDefinition<S>,
): McpToolDefinition<S> {
  return def
}