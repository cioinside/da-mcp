/**
 * Server-level instructions surfaced to the AI agent via the MCP `instructions`
 * field (MCP spec 2025-06-18, ServerOptions.instructions). MCP clients
 * (OpenCode, Claude Desktop, etc.) are expected to inject this string into the
 * agent's system prompt at session start.
 *
 * The point of this string is to prevent a failure mode we have observed in
 * practice: an agent receives a task ("open Notepad, type X, save to Y"),
 * reads the 12 da_* tool descriptions, and concludes that it should write an
 * orchestrator script (Node.js / shell / Python) that imports the da-mcp
 * package, spawns the server, and pipes JSON-RPC to it. That is wrong:
 *
 *   - The MCP server is already running as a managed subprocess of the agent's
 *     MCP client. The agent is *not* the orchestrator; it is *the caller of*
 *     the orchestrator (the client's MCP tool-calling interface).
 *   - Two layers of indirection (agent → child script → MCP server) defeat
 *     streaming, structured error envelopes, and the agent's ability to react
 *     to in-band results.
 *   - It also recreates the stdio framing problem (newline-delimited JSON
 *     vs. Content-Length) that bit us in issue #1.
 *
 * The string below states this in three short paragraphs: (1) what the
 * server exposes, (2) what the agent must NOT do, (3) how multi-step tasks
 * are expressed. Wording is intentionally direct — every sentence is
 * something an agent might otherwise get wrong.
 */
export const SERVER_INSTRUCTIONS = [
  'da-mcp exposes 14 desktop-automation tools over this MCP connection:',
  'da_screenshot, da_ocr, da_list_displays, da_window_list, da_window_focus,',
  'da_get_mouse_position, da_move_mouse, da_click, da_double_click, da_drag,',
  'da_scroll, da_type, da_key, da_launch.',
  'You, the AI agent, ARE the orchestrator. Invoke these tools directly through',
  'your tool-calling interface, one call per logical action. Each tool call',
  'blocks until the action completes and returns its result in-band.',
  '',
  'Do NOT write an orchestrator script, a Node.js program, a Python script, or',
  'a shell pipeline that imports the da-mcp package, spawns the server, or',
  'pipes JSON-RPC to it. The MCP server is already a managed subprocess of',
  'your MCP client. Reaching for `child_process.spawn`, `import \'da-mcp\'`,',
  'or hand-rolled JSON-RPC framing means you have misread the architecture.',
  '',
  'For multi-step tasks (e.g. "open Notepad, type text, save to file") emit a',
  'sequence of independent tool calls — da_launch, da_screenshot, da_click,',
  'da_type, da_key, etc. — and use each result to decide the next call. Tool',
  'calls block until completion; verify the expected UI state with da_screenshot',
  'before proceeding when a step\'s effect is uncertain. The MCP transport uses',
  'newline-delimited JSON, one JSON-RPC object per line, NOT LSP Content-Length',
  'framing — but you only need to know that if you ever reach for the wire.',
].join('\n')
