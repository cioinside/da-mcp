---
name: da-ui-orchestrator
description: "Use when the task requires interacting with a graphical desktop application through da-mcp tools (the 20 da_* MCP tools for screenshot, OCR, mouse, keyboard, window management, waits, and pixel-level verification). Triggers on tasks like 'open [app] and click [element]', 'fill in this form', 'navigate to [screen]', 'draw [shape]', 'close the dialog'. Universally applicable to any GUI application: Paint, browsers, IDEs, dialogs, file managers, native apps. Triggers: 'click', 'type', 'screenshot', 'focus window', 'OCR', 'da_*', 'desktop automation', 'GUI task'."
---

# da-ui-orchestrator: Plan and execute GUI tasks with da-mcp

You are the orchestrator. da-mcp exposes 20 `da_*` tools (screenshot, OCR, mouse, keyboard, window management, waits, pixel verification, launch). Call them through your tool-calling interface and let the MCP server do the work. Do not write a Node.js / Python / shell script that imports da-mcp or pipes JSON-RPC to it.

## The 6-step loop

Every GUI task follows this loop, in this order:

1. **Orient**: `da_window_list` then identify the target window by title or hwnd, then `da_window_focus({ title | hwnd })`. After `da_launch`, always `da_wait_for_window({ title })` to confirm the new app is painted before clicking inside it. The target window MUST be foreground before any input lands, or keystrokes and clicks hit the wrong app.
2. **Observe**: `da_screenshot` (always; the model has visual sense) and optionally `da_ocr` when you need exact text or coordinates from the image.
3. **Locate**: pick the cheapest reliable discovery strategy for each target (see §2). Resolve bbox or coordinates before acting. Use `da_find_text({ text })` when you want the bbox without committing to a click.
4. **Act**: execute exactly one state-changing tool call. Reading actions (`da_screenshot`, `da_ocr`, `da_list_displays`, `da_window_list`, `da_get_mouse_position`, `da_find_text`, `da_wait_for_window`, `da_wait_for_text`, `da_verify_pixels` after match) do not change UI; writing actions (`da_click`, `da_click_text`, `da_double_click`, `da_drag`, `da_draw_path`, `da_scroll`, `da_type`, `da_key`, `da_move_mouse`, `da_launch`, `da_window_focus`) do.
5. **Verify**: `da_screenshot` after every non-trivial action. After a state-changing action, prefer `da_wait_for_text` (wait for OCR-visible text to appear) or `da_verify_pixels` (wait for a pixel predicate to hold) over re-screenshot+visual-poll. If state does not match expectation, return to §3; do not stack another action on top of an unverified one.
6. **Iterate**: repeat until the task is complete. Each iteration is small and verifiable.

## Discovery strategy hierarchy (preference order)

Pick the cheapest reliable method per target element. Do not skip levels without reason.

1. **Keyboard shortcut known**, then `da_key({ key: 'Ctrl+L' })` or similar. Cheapest and most reliable. Research the app's shortcuts first (browser DevTools, common `Ctrl+<key>` combos, OS-level like `Cmd+Tab` / `Alt+Tab` for app switching).
2. **Text label visible**, then `da_click_text({ text, fuzzy: true })` to click immediately, or `da_find_text({ text, fuzzy: true })` to inspect the bbox first. OCR handles case/whitespace variation. Best for menu items, buttons, dialog labels, tabs.
3. **Icon with no text**, then `da_screenshot` plus a visual scan by the model, plus `da_click({ x, y })`. Slow but unavoidable when OCR fails.
4. **Pixel-level verification needed**, then `da_verify_pixels({ predicate: { kind: "color", rgb: [255,0,0], minCount: 200 } })`. Use this to confirm visual effects (e.g. "did the red circle get drawn?") without parsing an OCR result.
5. **Absolute coords known and stable**, then `da_move_mouse` or `da_click` directly. Only when geometry is fixed (a docked panel, a known toolbar position).

Do not re-screenshot if you already have a recent capture. Reuse the result mentally and re-shoot only when state plausibly changed (focus, animation, navigation, async load).

## Screen vs window coordinate system

- All `da_*` coordinates are **screen** (global desktop) coordinates, NOT window-relative.
- `da_window_list` returns each window's `rect: { x, y, width, height }`. To click inside the window, add `window.x` to your desired interior-x and `window.y` to your desired interior-y.
- Mouse positions must land inside the window's client area (not the title bar / chrome). Skip the title bar height (typically 28-40 px on macOS / Linux, about 32 px on Windows).
- Multi-display: `da_list_displays` returns per-display bounds; coordinates are absolute across all displays. Use the `displayId` argument on `da_screenshot` to capture one screen at a time.

## Drawing and freeform shapes

- `da_drag` is a straight line, use it for sliders, text selection, or "drag corner-to-corner" with a shape tool already active.
- For curves, circles, signatures, hand-drawn shapes: `da_draw_path({ points: [...], modifiers: ['shift']? })`. Approximate curves as N=24+ points sampled along the path. Pass `modifiers: ['shift']` when the app expects a constrained line (e.g. a 45-degree lock).
- For shape-tool-dependent apps (drawing tools, annotation, editors): the tool MUST be selected FIRST via `da_click_text` or a keyboard shortcut, THEN draw. Use `da_screenshot` to verify the tool is active before drawing. Drawing with the wrong tool selected is the number-one silent-failure mode here.
- After drawing, verify with `da_verify_pixels({ predicate: { kind: "color", rgb, minCount }, region: { x, y, width, height } })` to confirm the shape actually appeared on the canvas.

## Verification after each step

- After every state-changing action, take `da_screenshot`. Add `da_ocr` when the visual state is ambiguous (small icons, low-contrast text, dense UIs).
- For state-changing actions whose effect is observable, prefer `da_wait_for_text` (block until a text label appears, e.g. "Done", "Connected", "Save successful") or `da_verify_pixels` (block until a pixel predicate holds). These are more reliable than re-screenshot+visual-poll because the tool server itself decides when the state is ready.
- If a click had no effect, check in order: (a) was the target window foreground? then `da_window_focus` again; (b) was the target visible and not occluded? then re-screenshot; (c) did the click land on the right bbox? then verify coords against the latest screenshot; (d) is a confirmation dialog or modal blocking? OCR will show it, dismiss with `da_key({ key: 'Escape' })` if appropriate.
- Never batch multiple click/type calls without intermediate verification. The agent that fires 10 clicks and then verifies is brittle; when (not if) one misses, you cannot tell which.

## Failure recovery

- **OCR returns empty**: UI may be slow to render. Take a fresh `da_screenshot` and retry OCR; if still empty, the surface may be image-only, so fall back to visual scan plus `da_click({ x, y })`.
- **Click had no effect**: verify window is foreground (`da_window_list` plus `da_window_focus`), verify coords.
- **Stuck in a modal / dialog**: `da_key({ key: 'Escape' })` usually dismisses. If not, OCR to see what the dialog wants and respond to its buttons.
- **Waiting for state that never appears**: `da_wait_for_text` and `da_wait_for_window` throw `NOT_FOUND` on timeout. On that error, debug from observed state, not original intent — re-screenshot, OCR, and reconsider.
- **Unexpected state**: screenshot plus OCR to inspect, then plan the next action from observed state, not from the user's original description. The user describes intent; the UI tells you what is actually true.

## Anti-patterns

- **Assuming coordinates without verifying**: do not hardcode positions learned from a previous session or a screenshot taken minutes ago. Re-shoot and re-locate.
- **Skipping window focus**: clicks and keystrokes land on whatever window is foreground, not the one you intend. Always focus first.
- **Busy-waiting**: do not call `da_screenshot` in a loop with `await new Promise(setTimeout)` — use `da_wait_for_text` or `da_wait_for_window` instead. The server-side polling is already throttled and the throw-on-timeout makes error handling trivial.
- **Batching state changes**: `da_click` then `da_type` then `da_key` without verifying in between loses debuggability and produces opaque failures.
- **Confusing display coords with window coords**: always consult `da_window_list` before launching into a window. Interior offsets matter.
- **Reaching for `da_launch` when the target is already running**: call `da_window_list` first; only launch if absent.
- **Writing an orchestrator script**: you ARE the orchestrator. Call `da_*` tools directly. Do not spawn the da-mcp server from a script, do not pipe JSON-RPC, do not import the package from your own code.

## Worked micro-examples

Each shows the 6-step loop in tool-call form. Patterns are generic; apply to any GUI app.

### Open a URL in a browser address bar and submit

```text
da_window_list                          # orient: find browser window
da_wait_for_window({ title: "..." })    # orient: confirm already foreground
da_window_focus({ title: "..." })       # orient: bring it foreground
da_key({ key: "Ctrl+l" })               # locate: keyboard shortcut to address bar
da_type({ text: "https://example.com" })# act: type URL
da_key({ key: "Return" })               # act: submit
da_wait_for_text({ text: "example.com" })# verify: page loaded (text visible)
```

### Find a menu item and click it

```text
da_window_list                          # orient
da_window_focus({ title: "..." })       # orient
da_screenshot                           # observe
da_click_text({ text: "View" })         # locate + act: open View menu
da_wait_for_text({ text: "Find" })      # verify menu opened (the menu item is visible)
da_click_text({ text: "Find" })         # locate + act: pick the menu item
da_screenshot                           # verify
```

### Type into a text field

```text
da_window_list                          # orient
da_window_focus({ title: "..." })       # orient
da_screenshot                           # observe
da_click_text({ text: "Search" })       # locate + act: focus the field by its label/placeholder
da_type({ text: "my query" })           # act: type
da_key({ key: "Return" })               # act: submit (if applicable)
da_screenshot                           # verify
```

### Draw a red circle in Paint (canonical "complex" scenario)

```text
da_launch({ argv: ["mspaint"] })        # orient: open Paint
da_wait_for_window({ title: "Paint" })  # orient: wait for it to paint
da_window_focus({ title: "Paint" })     # orient: foreground
da_click_text({ text: "Ellipse" })      # locate + act: pick the shape tool
da_click_text({ text: "Color 1" })      # locate + act: open color picker
da_screenshot                           # observe: see the color dialog
da_click({ x: <OK button>, y: <OK> })   # act: confirm red (or use OCR to find OK)
da_draw_path({                          # act: trace the circle
  points: [<N points on circumference>],
  modifiers: ["shift"],                 # constrain to a perfect circle
})
da_verify_pixels({                      # verify: 200+ red pixels on canvas
  region: { x: <canvas.x>, y: <canvas.y>, width: <w>, height: <h> },
  predicate: { kind: "color", rgb: [255, 0, 0], minCount: 200 },
})
```

### Find a menu item and click it

```text
da_window_list                          # orient
da_window_focus({ title: "..." })       # orient
da_screenshot                           # observe
da_click_text({ text: "View" })         # locate + act: open View menu
da_screenshot                           # verify menu opened
da_click_text({ text: "Find" })         # locate + act: pick the menu item
da_screenshot                           # verify
```

### Type into a text field

```text
da_window_list                          # orient
da_window_focus({ title: "..." })       # orient
da_screenshot                           # observe
da_click_text({ text: "Search" })       # locate + act: focus the field by its label/placeholder
da_type({ text: "my query" })           # act: type
da_key({ key: "Return" })               # act: submit (if applicable)
da_screenshot                           # verify
```
