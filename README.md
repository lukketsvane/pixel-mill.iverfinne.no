# Pixel Mill / Max Level Studio

A full-screen, black-and-white pixel level editor. Starts empty. The original Pixel Mill Site is separate and unchanged.

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

Node 22 or later; no package dependencies.

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
