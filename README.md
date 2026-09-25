# Pixel Mill / Max Level Studio

A full-screen pixel level editor with two workspaces: **Level** for authoring space, and **Assets** for organizing its visual sources. Starts empty.

## Sketch → artwork

Draw immediately on an empty level. The bottom color circle opens three semantic sketch colors: mint for walkable shapes, blue for background, orange for decoration. Drawing stays active between shapes. Color, semantic role and collision kind are separate properties; applying a visual treatment never changes the authored bounds, rotation, collision inset, spawn or collision kind.

Select references in **Assets**, then choose **Use sheets** to apply existing pixels directly. Environment sheets use their assigned role; a 3 × 3 terrain patch supplies edges, corners and interior tiles, including joined neighboring surfaces. Larger sheets allow choosing the patch on the image. Character animation sheets remain references and are excluded from terrain painting. No image-generation request is made by this action.

**ChatGPT ↗** prepares an immutable handoff and downloads a ZIP containing `clownmap.png`, `request.json`, selected reference PNGs, their structured sheet metadata, and a prompt. Attach it in ChatGPT. A connected agent can instead call `prepare_artwork` / `get_artwork_request` with `includeImages:true` to receive the same map, structure and references together. Generation happens in ChatGPT; the editor does not simulate it or require the site's API key for this route.

Return one coherent PNG with the same framing and aspect ratio. The down-arrow imports it, or the agent calls `apply_artwork` with its request ID and PNG. Pixel Mill maps the result to the original shapes automatically as a separate artwork binding. A changed target layout or source reference is rejected; unrelated edits can continue while generation runs. Select a region with the rectangle control (or Shift-drag) to use the same loop on fully enclosed shapes. Clear the scope to treat the whole level. Requests retain their exact target IDs. Multiple pending requests can be selected when importing a result.

Every application is one undo step. **Restore sketch** removes the treatment while retaining both the editable geometry and source artwork. Save/Open, cloud synchronization and ZIP export preserve the artwork bindings and requests. As with any image generation, visual fidelity to the requested silhouette depends on the returned artwork; the application's geometry and collision invariants are enforced independently.

## Character sheets and animation groups

**+** opens import options with a **16 px** default. Sheet import preserves the full source image, transparent margins and pixel scale. A confident regular grid is grouped immediately; ambiguous images show a detected grid or 16 px suggestion that can be corrected.

An 8 × 8 character sheet is one `sprite_sheet` asset with eight expandable animations and 64 exact frame cells. A cell retains all its disconnected details, repeated poses and empty frames. Groups hold ordered frame references, animation speed, looping and a shared alignment origin. No pose is independently recentered. Environment sheets use the same structure for material sets and tiles.

**Group selected** collects existing assets without creating another stored PNG. **Group level selection** infers rows, columns, empty slots and common spacing from placed sprites at a common scale. These collections retain references to the original source assets. Editing a source updates its containing sheets. Grouping and ungrouping are single undo steps; Undo is available in Assets.

Tap an animation to inspect its frames, rename it, reorder rows or frames, and preview playback in place. Select frames or groups to merge, split or regroup manually. Grid settings allow row/column/manual grouping, cell dimensions, gutters, offsets and empty-cell retention. Export the selected frame, animation strip, full sheet or several sheets as an asset pack. Exports retain original sources, frame order, grouping and animation settings alongside the rendered PNGs.

**Use as reference** attaches the current frame, animation or full sheet to ChatGPT requests. The handoff includes the composed reference image and its hierarchy, frame membership, timing and exact image placements. **ChatGPT ↗** prepares a targeted asset request; **Apply return** imports the returned PNG to replace only those original frame bindings. Generated pixels become a retained source, while the original sheet and other frames remain editable. A selected frame may also guide another animation in the same sheet. Stale target changes are rejected, and applying a result is one undo step.

## Editing

Import multiple images, remove their background, scale with nearest-neighbor sampling, and split disconnected components. Tap an asset and then the canvas to place it. Placement automatically returns to the cursor with the new piece selected.

Drag a piece to move it. Its corner handle and numeric dimensions preserve aspect ratio. With two fingers on a piece, move and rotate; a horizontal pinch stretches width, a vertical pinch stretches height, and a diagonal pinch scales both. Two fingers starting on empty canvas pan and zoom the view without rotating it. Piece rotation snaps to 5° throughout the gesture and in numeric fields. Drag any number sideways to scrub; tap to type. A scrub previews live and commits one undo step. Drag the asset tray’s top grip to expand to two or four rows; drag down to collapse. Finger changes rebase the gesture; cancellation restores the original piece; each gesture is one undo step.

Long-press or right-click a piece for lock/unlock, layer order, opacity and crop. Choose Crop and drag the rectangle to keep; Reset crop restores the full source. Cropping is non-destructive. Locked pieces can be selected for unlocking but cannot be transformed. Rotation, crop, opacity and layer order are retained in projects and the exported level PNG.

Choose solid, one-way platform or decoration collisions, and adjust the collision top inset. Position Max's spawn and press Play. Mobile play has no visible controls: drag to steer, swipe up to jump, flick sideways to dodge. An X in the corner or a stationary two-finger tap returns to editing. On a keyboard, arrows/A/D steer, Up/W jumps, Shift runs, K/X dodges, and Esc returns to editing.

The Pixels toggle rasterizes all artwork together at one native world pixel per canvas pixel before zooming, so scaled and rotated assets share the same pixel grid. Toggle it off for the direct rendering view. Bounded tiles limit buffer size; camera zoom does not rotate the canvas.

Every committed edit is cached in IndexedDB and autosaved to cloud storage after 750 ms idle. Offline edits retry when connectivity returns and every 15 seconds. The Projects menu reopens cached projects; the project URL can reopen its cloud copy on another device. A stale cloud revision creates a recovery copy, preserving both versions. Project files do not expire; agent-session links remain separately revocable.

Save/Open use self-contained JSON files. Export ZIP includes named transparent asset PNGs, placed level artwork, the editable project and a Max-format collision geometry reference. Unzip and drag the PNGs into Figma.

## Chat and agents

The Chat button offers a ChatGPT connection when no API key is configured. Create a level link, copy its MCP URL, and add it as a personal plugin in ChatGPT Developer mode with authentication None. Select the plugin in a Work chat to co-design the level using your ChatGPT account. Sign-in and conversation happen in ChatGPT; this is not embedded ChatGPT login or API access through a subscription. Account/workspace policy must allow Developer mode. The private link grants access only to this level; Disconnect revokes it. [Official setup instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt).

When the site has its own API key, the Chat button also supports a small in-editor conversation. GPT can inspect uploaded assets, edit a draft with the existing level tools, and test jumps. Successful changes commit atomically as one undo step; concurrent edits cancel the draft instead of overwriting user work. Chat needs the server secret `OPENAI_API_KEY`; without it the interface clearly reports that chat is not connected. `OPENAI_MODEL` defaults to `gpt-6-sol`. `CHAT_DAILY_LIMIT` defaults to 50 chat requests per day for this site. No provider keys reach the browser or repository.


Project → Agent → Connect → Copy MCP URL. Add that URL to an MCP Streamable HTTP client. A link authorizes one shared level, persists its project on the host, and lets human and agent edits share undo history. Disconnect revokes it. Idle links expire after seven days. Keep the editor open for previews and live co-design. MCP tools can upload PNGs, remove backgrounds, split imported sheets into exact cells, and compose transparent spritesheets from assets. [Agent API details](dist/agents.md).

Browsers with WebMCP support also expose the same tools directly, without requiring a remote room. Other browsers use the remote MCP endpoint.

## Development and hosting

Node 22 or later. The Vercel adapter uses `@vercel/blob`; editor and Worker logic otherwise use platform APIs.

```sh
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

The static server supports editing and local WebMCP. Autosave cloud storage and chat need the Worker backend. Remote MCP needs the included Worker, not just static hosting: build produces `dist/server/index.js`, which serves the frontend and `/api/rooms/*` / `/mcp/*` routes. Bind a Cloudflare R2 bucket as `BUCKET`. Rooms use conditional writes, revision checks and per-piece conflict detection. No credentials are bundled.

On Vercel, the same-origin `/api/*` and `/mcp/*` routes run in `api/handler.js`, with private Vercel Blob storage for rooms, previews and project saves. Create a **private** Blob store in the Vercel project and connect it to Production (and Preview if needed); Vercel supplies `BLOB_READ_WRITE_TOKEN`, or an OIDC token and `BLOB_STORE_ID`. Redeploy after connecting the store. The project returns HTTP 503 until storage is configured. Do not put the Blob token in the browser or GitHub. The GitHub repository and custom domain are configured in the Vercel project, separately from this code.

## Max reference and verification

`dist/assets/max.png` is the unmodified 256 × 256 embedded player sheet from `lukketsvane/max.iverfinne.no`, retrieved 2026-09-24. Frames are 32 × 32, anchor (16,31), with interpolation disabled. Base movement constants and touch thresholds follow the source game. This is a terrain playtester; gardening, class perks, enemies and inventory are not included. The source game is not modified.

Automated checks cover multi-image import, placement returning to cursor, saving/opening, ZIP export, physics, gesture handoffs and cancellation, proportional resizing, touch stretching, long press, cropping, locks, layer order, opacity, MCP requests, conflicts, undo and revocation. Physical iPhone verification has not been performed.

Artwork and sprite-sheet tests cover real HTTP MCP handoffs, unchanged collision geometry, region isolation, stale-request rejection, direct terrain-sheet reuse, hierarchy persistence, reordered pixel exports and one-step undo. Opt-in Playwright browser verification uses `PIXEL_MILL_BROWSER=1 node --test tests/*browser.test.mjs`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Chromium is outside Playwright's cache. `PIXEL_MILL_GENERATED_IMAGE` accepts a genuine generated PNG for the full live image round trip.
