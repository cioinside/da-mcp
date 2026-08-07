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
  'da-mcp exposes 20 desktop-automation tools over this MCP connection:',
  'da_screenshot, da_ocr, da_list_displays, da_window_list, da_window_focus,',
  'da_wait_for_window, da_get_mouse_position, da_move_mouse, da_click, da_click_text,',
  'da_find_text, da_wait_for_text, da_verify_pixels, da_double_click, da_drag,',
  'da_draw_path, da_scroll, da_type, da_key, da_launch.',
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
  '',
  'Stable patterns for complex GUI scenarios — follow these unless you have a reason not to:',
  '1. After da_launch, ALWAYS call da_wait_for_window before any further action.',
  '   A freshly-launched app is rarely painted by the time da_launch returns.',
  '2. To click a button/menu/label whose text you know, use da_click_text(text)',
  '   — it OCR-resolves the bounding box and clicks the center. Avoid guessing',
  '   (x, y) coordinates for known UI labels: clicks that miss by a few pixels',
  '   are the #1 cause of "the dialog never opened" failures.',
  '3. To inspect position without committing to an action, use da_find_text(text)',
  '   — same match semantics as da_click_text but no click is performed.',
  '4. To wait for a dialog/label/dynamic content to appear, use da_wait_for_text(text)',
  '   instead of sleeping and retrying. Same match semantics; throws NOT_FOUND',
  '   on timeout so the caller can branch on stale state.',
  '5. To verify the visual result of an action, use da_verify_pixels with a',
  '   {kind:"color", rgb, minCount} or {kind:"diff", baseline, threshold}',
  '   predicate. E.g. after drawing in Paint, verify 200+ red pixels appeared',
  '   on the canvas region.',
  '6. For freeform shapes (circles, signatures, lines in Paint) use da_draw_path',
  '   with N points on the circumference and modifiers:["shift"] for constrained',
  '   drawing in Paint. Do NOT attempt pixel-perfect single-line drags with da_drag',
  '   when da_draw_path will be both faster and more accurate.',
  '7. When a task is solvable via clipboard, hotkeys, or a typed string, prefer',
  '   that over mouse manipulation. E.g. "paste an image into Paint" is faster',
  '   and more reliable than synthesizing clicks on the Paste menu.',
].join('\n')
