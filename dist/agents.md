# Pixel Mill agent connection

Open Chat → Create link, then Copy MCP URL (or Project → Agent). In ChatGPT, enable Developer mode under Settings → Security and login, add a personal plugin using the URL and authentication None, then select it in a Work chat. [Setup](https://developers.openai.com/plugins/deploy/connect-chatgpt). Availability depends on account and workspace policy. The conversation and login happen in ChatGPT; the editor receives tool edits, without an OpenAI API key.

 Add that private URL to a client that supports MCP Streamable HTTP. No additional API key is needed: the unguessable link authorizes access to this level. Disconnect revokes the link. Idle links expire after seven days; active edits renew them.

The MCP connection exposes `get_level`, `get_asset_image`, `get_canvas_preview`, `edit_level`, `undo_level`, `simulate_player`, `set_play_mode`, `import_image`, `slice_spritesheet`, and `create_spritesheet`. In browsers supporting WebMCP, the same tools are registered automatically on the page.

`import_image` takes a PNG data URL, a name, and the current revision. PNGs must be 8-bit, non-interlaced, at most 4096 px per side and four million pixels. Convert JPEG/WebP inputs to PNG first. Optional `removeBackground`, `backgroundColor` (RGB triplet), `tolerance`, `scale`, `split`, `minArea`, and `palette` use the editor's pixel processing. Without options, the PNG is imported unchanged. The returned asset IDs can be placed with `edit_level`.

`slice_spritesheet` takes an imported asset ID and exact row/column counts. The sheet must divide evenly; every frame is preserved in row-major order, including transparent cells. `create_spritesheet` takes existing asset IDs in frame order, a column count, and exact cell width/height. It centers each source horizontally and aligns its bottom to the cell bottom, with no resampling; sources larger than a cell are rejected. It adds the resulting transparent PNG to the asset tray and returns the image. Both actions require the latest revision and each is one undo step.

Start with `get_level`, inspect the asset IDs and latest canvas preview, then send a batch of `edit_level` operations with the returned revision. Each batch is one undo step. Stale revisions fail without changing the project. Human and agent edits to different pieces merge; conflicting changes to one piece preserve the local edit and report the conflict. Keep the editor open to see edits and provide current canvas previews.

Coordinates are native game pixels, positive x right and positive y down. Objects use x/y of the unrotated rectangle, w/h, and rotation in degrees about the center, snapping to 5° when edited. Positions finish on the native pixel grid. Max's spawn is his foot position. Base speeds are 48 walk and 88 run; full jump height is about 27 pixels. Collision types are `solid`, one-way `platform`, and non-colliding `decor`. `inset` moves the collision top down inside the piece.

Example `edit_level` arguments:

```json
{"revision":0,"operations":[{"type":"block","id":"floor","x":-80,"y":0,"width":160,"height":12},{"type":"spawn","x":0,"y":0}]}
```

Other operations: `place` with an existing assetId; `update` with an id and changes containing x/y/w/h/rotation/kind/inset/flip/name/locked/opacity; `duplicate` with id and dx/dy; `delete` with ids; `rename` with name. Use `order` with id and direction (`front`, `back`, `forward`, `backward`) to move layers. Use `crop` with id and `rect: {x,y,w,h}` in the piece’s local displayed pixels; `reset: true` restores the source. Opacity ranges from 0 to 1. Unlock a piece with `update` and `locked: false` before transforming or deleting it. Assets can be imported through the editor or `import_image`; pixels are preserved unless processing options are requested.

Use `simulate_player` with route segments such as `{"seconds":0.4,"axis":1,"jump":true,"run":true}` to check a proposed jump. Tests are limited to ten seconds per request. The simulator covers Max's base movement and terrain collisions, not the full game's enemies, gardening or class perks.

MCP room files are persisted by the host. Save downloads a standalone JSON project; Export ZIP includes the named PNGs and placed level artwork. Agent links allow edits, so share them only with agents you intend to control this level.
