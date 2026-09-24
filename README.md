# Pixel Mill / Max Level Studio

A full-screen, black-and-white pixel level editor. Starts empty. The original Pixel Mill Site is separate and unchanged.

## Editing

Import multiple images, remove their background, scale with nearest-neighbor sampling, and split disconnected components. Tap an asset and then the canvas to place it. Placement automatically returns to the cursor with the new piece selected.

Drag a piece to move it. Its corner handle and numeric dimensions preserve aspect ratio. With two fingers on a piece, move and rotate; a horizontal pinch stretches width, a vertical pinch stretches height, and a diagonal pinch scales both. Two fingers starting on empty canvas manipulate the view. Finger changes rebase the gesture; cancellation restores the original piece; each gesture is one undo step.

Long-press or right-click a piece for lock/unlock, layer order, opacity and crop. Choose Crop and drag the rectangle to keep; Reset crop restores the full source. Cropping is non-destructive. Locked pieces can be selected for unlocking but cannot be transformed. Rotation, crop, opacity and layer order are retained in projects and the exported level PNG.

Choose solid, one-way platform or decoration collisions, and adjust the collision top inset. Position Max's spawn and press Play. Mobile play has no visible controls: drag to steer, swipe up to jump, flick sideways to dodge. A stationary two-finger tap returns to editing. On a keyboard, arrows/A/D steer, Up/W jumps, Shift runs, K/X dodges, and Esc returns to editing.

Save/Open use self-contained JSON files. Export ZIP includes named transparent asset PNGs, placed level artwork, the editable project and a Max-format collision geometry reference. Unzip and drag the PNGs into Figma.

## Agents

Project → Agent → Connect → Copy MCP URL. Add that URL to an MCP Streamable HTTP client. A link authorizes one shared level, persists its project on the host, and lets human and agent edits share undo history. Disconnect revokes it. Idle links expire after seven days. Keep the editor open for previews and live co-design. [Agent API details](dist/agents.md).

Browsers with WebMCP support also expose the same tools directly, without requiring a remote room. Other browsers use the remote MCP endpoint.

## Development and hosting

Node 22 or later; no package dependencies.

```sh
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

The static server supports editing and local WebMCP. Remote MCP needs the included Worker, not just static hosting: build produces `dist/server/index.js`, which serves the frontend and `/api/rooms/*` / `/mcp/*` routes. Bind a Cloudflare R2 bucket as `BUCKET`. Rooms use conditional writes, revision checks and per-piece conflict detection. No credentials are bundled.

The Vercel configuration, when included in the GitHub checkout, serves the static editor. Remote MCP on a Vercel-hosted frontend requires its API routes to be connected to the Worker backend. Publishing this repository does not itself configure a Vercel project or domain.

## Max reference and verification

`dist/assets/max.png` is the unmodified 256 × 256 embedded player sheet from `lukketsvane/max.iverfinne.no`, retrieved 2026-09-24. Frames are 32 × 32, anchor (16,31), with interpolation disabled. Base movement constants and touch thresholds follow the source game. This is a terrain playtester; gardening, class perks, enemies and inventory are not included. The source game is not modified.

Automated checks cover multi-image import, placement returning to cursor, saving/opening, ZIP export, physics, gesture handoffs and cancellation, proportional resizing, touch stretching, long press, cropping, locks, layer order, opacity, MCP requests, conflicts, undo and revocation. Physical iPhone verification has not been performed.
