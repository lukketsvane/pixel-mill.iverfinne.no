# Pixel Mill / Max Level Studio

A full-screen pixel level editor with two workspaces: **Level** for authoring space, and **Assets** for organizing its visual sources. Starts empty.

## Sketch → artwork

Draw immediately on an empty level with the freehand brush. The bottom color circle opens three semantic mask layers: mint for walkable shapes, blue for background, orange for decoration. Native masks retain every painted pixel and erased hole, including in collisions, generated artwork, saved projects and Figma exports. Drawing stays active between strokes and after undo. Color, semantic role and collision kind are separate properties; applying a visual treatment never changes the authored bounds, rotation, collision inset, spawn or collision kind.

Pen input uses coalesced movement samples and pressure, with a native brush-size cursor. The pen eraser end, barrel button or held Alt temporarily erases; Space temporarily pans. Palm touches cannot interrupt an active pen stroke. Brush and eraser remember separate sizes from 1–256 native pixels. Erasing affects the current semantic layer, or a selected image; choose All unlocked layers to erase across layers. Original image sources remain intact. Each stroke is one undo step, and Escape cancels an unfinished stroke. These paths have automated Chromium pen coverage; physical Cintiq hardware has not been verified.

Keyboard: **B** brush, **E** eraser, **R** rectangle, **V** select, **H** hand, **C** collision brush, **M** Max, **L** ladder, **1 / 2 / 3** walkable/background/decoration, **[ / ]** brush size, **P** pressure, **Shift+E** eraser scope, **F** fit, **+ / −** zoom, **0** native size, **G** grid, **Shift+G** pixels and **Tab** Level/Assets. **Ctrl/Cmd+Z** undoes, **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redoes, **Ctrl/Cmd+S** saves, **Ctrl/Cmd+O** opens, **Ctrl/Cmd+I** imports, and **Ctrl/Cmd+Shift+S** exports ZIP. **Ctrl/Cmd+Enter** prepares ChatGPT artwork; add Shift to import its return. **Ctrl/Cmd+K** or **?** opens the searchable command palette, including other editor actions. Text fields retain their ordinary editing keys.

Select references in **Assets**, then choose **Use sheets** to apply existing pixels directly. Environment sheets use their assigned role; a 3 × 3 terrain patch supplies edges, corners and interior tiles, including joined neighboring surfaces. Larger sheets allow choosing the patch on the image. Character animation sheets remain references and are excluded from terrain painting. No image-generation request is made by this action.

The editor creates or reconnects a private level link in the background at startup, including unnamed drafts, while drawing stays available. The link is cached before the first request, reused after reload or a lost response, and retried with backoff when offline. Naming a draft promotes the same live level into durable project storage. Explicitly disconnecting keeps automatic connection disabled for that project.

**Ctrl/Cmd+Enter** quietly prepares or reuses the current level artwork request. A small sparkle indicates that it is ready for the connected ChatGPT conversation. There is no instruction dialog or automatic file download. Ask ChatGPT in that conversation to generate the level; it reads `get_artwork_request` with `includeImages:true`, invokes image generation with the semantic masks and active asset references, then calls `apply_artwork` with the generated `file`. Pixel Mill downloads the PNG itself and applies it to the original shapes; the open editor updates live. Selected references take priority; otherwise the editor uses visible assets actually placed in the level, including applied artwork. Unused imports are excluded. Preparing a request does not itself run image generation: the connected ChatGPT conversation invokes that tool. The ChatGPT connection is set up once through Chat or Project/Agent. Refresh an existing connection's tool list after upgrading if it does not expose the new file input. Manual PNG import and project ZIP export remain available when explicitly requested.

ChatGPT returns one coherent PNG with the same framing and aspect ratio. The agent calls `apply_artwork` with its request ID, current revision and the generated file; the server uses the temporary download URL without saving it. The same request and file ID can be retried after a lost reply without duplicating the edit. Import artwork remains available for manual returns. Pixel Mill maps the result to the original shapes automatically as a separate artwork binding. Artwork return uses the newest project version and preserves unrelated edits, even if the starting revision is older. A changed target layout, mask or reference image is rejected. Organizing a reference without changing its visible pixels is accepted for new requests. Shared Undo and Redo remain available while connected. Select a region with Artwork → Select region (or Shift-drag) to use the same loop on fully enclosed shapes. Clear the scope to treat the whole level. Requests retain their exact target IDs. Multiple pending requests can be selected when importing a result.

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

Choose solid, one-way platform, ladder or decoration collisions, and adjust the collision top inset. Position Max's spawn and press Play. Mobile play has no visible controls: drag to steer, swipe up to jump, flick sideways to dodge. An X in the corner or a stationary two-finger tap returns to editing. On a keyboard, arrows/A/D steer, Up/W jumps or climbs, Down/S descends, Space/J jumps off a ladder, Shift runs, K/X dodges, and Esc returns to editing. Add a ladder from the project menu or press L; imported artwork can also use Ladder collision. Vertical touch drags climb nearby ladders; releasing holds position and steering sideways leaves the ladder. Ladders support top and bottom exits, one-way platforms, solid ceilings and angled placement. They remain non-solid when not climbing.

The Pixels toggle rasterizes all artwork together at one native world pixel per canvas pixel before zooming, so scaled and rotated assets share the same pixel grid. Toggle it off for the direct rendering view. Bounded tiles limit buffer size; camera zoom does not rotate the canvas.

Every committed edit is cached in IndexedDB and autosaved to cloud storage after 750 ms idle. Saved projects and connected agent sessions use the same durable save queue. An interrupted save retains its edit identifier across reloads, so retries cannot duplicate a committed change. Offline saves retry with bounded backoff and immediately when connectivity returns; Projects also offers Retry cloud saving. The Projects menu reopens cached projects; the project URL can reopen its cloud copy on another device. Independent fields merge, including human movement and AI styling on the same object. Conflicting edits retain the local version and offer an explicit recovery copy or the latest cloud version. Project files do not expire; agent-session links remain separately revocable.

A cloud read failure preserves the project URL and presents Retry instead of silently replacing the project with an empty canvas. Already cached projects remain editable and exportable during an outage. Live updates pause in hidden tabs, notify connected listeners immediately within a server instance, and use slower conditional checks across instances. Failed connections back off instead of repeatedly querying unavailable storage. Unchanged image sources are omitted from project and room refreshes using verified source fingerprints.

Large cloud requests and downloads use temporary 1 MiB parts with SHA-256 verification, keeping each request below the hosting platform's payload limit. The complete project is validated and committed atomically after all parts arrive. Interrupted transfers retain local work for retry; parts are private by capability link, removed after use and expire after 30 minutes. MCP clients retain their existing response format.

Save/Open use self-contained JSON files. Export ZIP includes named transparent asset PNGs, placed level artwork, the editable project and a Max-format collision geometry reference. Ladders are exported separately from ledges and solid blocks.

## Figma import and export

Project menu → **Figma import / export** → **Download Figma kit** produces a self-contained ZIP with a local development plugin and `level.figma.json`. In the Figma desktop app, import `figma-plugin/manifest.json` as a development plugin, run Pixel Mill Bridge, and choose the kit JSON. No network, provider token or Blob access is needed.

The bridge creates a native component library and a Level frame with separate editable pieces and a Spawn marker. Original PNGs, world origin, sprite-sheet hierarchy, artwork bindings, painted collision and ladders are retained. Repeated appearances reuse components. Move, rotate, resize, reflect, reorder, duplicate or remove pieces; drag component instances into the Level frame to add them. Use the plugin's collision selector to assign solid, platform, ladder or decoration behavior. Each import creates its own snapshot without replacing earlier Figma work.

Select the Level frame and choose **Export back to Pixel Mill**. **Import changes** merges its return JSON against the original export, preserving independent current editor and ChatGPT changes. Conflicting same-field edits leave the current project untouched. **Open as new project** opens a separate copy for comparison. Imports are one undo step. Untouched images and hierarchy remain original; changed Figma artwork and new drawings become separate PNG assets while source images are retained. Transformed painted collision must use uniform scale without rotation; skew is rejected. Keep exactly one Spawn marker.

The plugin and browser flows have automated round-trip coverage using a Figma API harness and Chromium. The development plugin still needs verification in the live Figma client. Its API usage follows the [Figma Plugin API](https://developers.figma.com/docs/plugins/) and [shared metadata limits](https://developers.figma.com/docs/plugins/api/properties/nodes-setsharedplugindata/).

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

On Vercel, the same-origin `/api/*` and `/mcp/*` routes run in `api/handler.js`. Production uses private Supabase Postgres storage through `PIXEL_MILL_STORAGE_URL` and the sensitive server-only `PIXEL_MILL_STORAGE_TOKEN`. Database writes compare the previous version atomically; stale writers cannot overwrite a concurrent edit. New project and agent tokens use a versioned namespace with 192 random bits, so saving new projects does not query the old Blob store.

The schema is in `database/pixel-mill-storage.sql` and the server function is in `supabase/functions/pixel-mill-storage/index.ts`. Apply the schema, generate a random 32-byte hexadecimal storage token, store only its SHA-256 hash in `pixel_mill_storage_credentials`, deploy the function with its custom bearer authentication, and set both Vercel environment variables before redeploying. The function's Supabase service credential stays inside Supabase. Anonymous and signed-in browser roles have no table or RPC permissions. The storage token must never be bundled in the frontend or committed to GitHub.

An existing private Blob connection remains a read-through migration source. On a successful legacy read the record is copied once into the new store with a conditional insert. Existing aliases, revisions, history and capabilities are preserved. When Blob is suspended, existing remote-only records remain unavailable; they are never replaced with empty projects. On a device with a cached copy, open Projects and choose **Save copy to cloud** to save a separate project on the new store. The original cached project and cloud link remain intact. Connect a new agent link from the recovered project if needed.

Without the two new environment variables, the Vercel handler retains its previous private Blob configuration using `BLOB_READ_WRITE_TOKEN`, or an OIDC token and `BLOB_STORE_ID`. The project returns HTTP 503 until a storage backend is configured. The GitHub repository and custom domain are configured in Vercel separately from this code.

A suspended Blob store can also return 403, including when credentials are valid. Check the connected store's usage and billing status in Vercel. The API translates storage failures to retryable HTTP 503 responses without exposing credentials. Code changes do not reset a provider quota or unsuspend a store. Reads and writes remain private, use stable paths, and preserve conditional-write protection; previews can overwrite their own stable path.

PNG data is stored once per record, even when repeated throughout undo history. Existing records remain readable and are compacted on their next successful save. API responses, local exports and Figma round trips still contain the original embedded PNGs.

To offload PNG images to ImgBB, add `IMGBB_API_KEY` as a sensitive server environment variable in Vercel and redeploy. Obtain a key at https://api.imgbb.com/. Enabling this opts into publicly accessible image URLs hosted by ImgBB; project metadata and edit capabilities remain in the private project store. The key is sent only in the server's upload body and never reaches the browser. Original images are downloaded and SHA-256 verified before their references are saved. Failed uploads retain embedded originals and back off for one minute; an upload batch has an 8-second budget. Frequent canvas previews stay in the private project store. No automatic upload expiry is requested. Existing external images must remain available on ImgBB for cold cloud reads; local project exports remain self-contained.

ImgBB does not replace the revisioned project database or lift an existing Blob suspension. With the new storage service configured, Blob is no longer required for new saves or new ChatGPT sessions. Deleting Blob files reduces stored bytes, but does not undo monthly operations or transfer usage. Confirm the exceeded quota before deleting project data.

## Max reference and verification

`dist/assets/max.png` is the unmodified 256 × 256 embedded player sheet from `lukketsvane/max.iverfinne.no`, retrieved 2026-09-24. Frames are 32 × 32, anchor (16,31), with interpolation disabled. Base movement constants and touch thresholds follow the source game. This is a terrain playtester; gardening, class perks, enemies and inventory are not included. The source game is not modified.

Automated checks cover multi-image import, placement returning to cursor, saving/opening, ZIP export, physics, gesture handoffs and cancellation, proportional resizing, touch stretching, long press, cropping, locks, layer order, opacity, MCP requests, conflicts, undo and revocation. Physical iPhone verification has not been performed.

Artwork and sprite-sheet tests cover real HTTP MCP handoffs, unchanged collision geometry, region isolation, stale-request rejection, direct terrain-sheet reuse, hierarchy persistence, reordered pixel exports and one-step undo. Opt-in Playwright browser verification uses `PIXEL_MILL_BROWSER=1 node --test tests/*browser.test.mjs`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Chromium is outside Playwright's cache. `PIXEL_MILL_GENERATED_IMAGE` accepts a genuine generated PNG for the full live image round trip.
