# Pixel Mill agent connection

Open Chat → Create link, then Copy MCP URL (or Project → Agent). In ChatGPT, enable Developer mode under Settings → Security and login, add a personal plugin using the URL and authentication None, then select it in a Work chat. [Setup](https://developers.openai.com/plugins/deploy/connect-chatgpt). Availability depends on account and workspace policy. The conversation and login happen in ChatGPT; the editor receives tool edits, without an OpenAI API key.

 Add that private URL to a client that supports MCP Streamable HTTP. No additional API key is needed: the unguessable link authorizes access to this level. Disconnect revokes the link. Idle links expire after seven days; active edits renew them.

The MCP connection also exposes `prepare_artwork`, `get_artwork_request`, `apply_artwork`, `apply_asset_sheet`, `group_sprite_sheet`, `inspect_sprite_sheet`, `edit_sprite_sheet`, and `export_sprite_sheet`. The existing tools are `get_level`, `get_asset_image`, `get_canvas_preview`, `edit_level`, `undo_level`, `simulate_player`, `set_play_mode`, `import_image`, `slice_spritesheet`, and `create_spritesheet`. In browsers supporting WebMCP, the same tools are registered automatically on the page.

`import_image` takes a PNG data URL, a name, and the current revision. PNGs must be 8-bit, non-interlaced, at most 4096 px per side and four million pixels. Convert JPEG/WebP inputs to PNG first. Optional `removeBackground`, `backgroundColor` (RGB triplet), `tolerance`, `scale`, `split`, `minArea`, and `palette` use the editor's pixel processing. Without options, the PNG is imported unchanged. The returned asset IDs can be placed with `edit_level`.

`slice_spritesheet` takes an imported asset ID and exact row/column counts. The sheet must divide evenly; every frame is preserved in row-major order, including transparent cells. `create_spritesheet` takes existing asset IDs in frame order, a column count, and exact cell width/height. It centers each source horizontally and aligns its bottom to the cell bottom, with no resampling; sources larger than a cell are rejected. It adds the resulting transparent PNG to the asset tray and returns its ID and dimensions; `includeImage: true` also returns the image. Both actions require the latest revision and each is one undo step.

Start with compact `get_level` once. Inspect only the images needed for the task, then send a batch of `edit_level` operations with the returned revision. Each batch is one undo step. Stale revisions fail without changing the project. Human and agent edits to different pieces merge; conflicting changes to one piece preserve the local edit and report the conflict. Keep the editor open to see edits and provide current canvas previews.

Coordinates are native game pixels, positive x right and positive y down. Objects use x/y of the unrotated rectangle, w/h, and rotation in degrees about the center, snapping to 5° when edited. Positions finish on the native pixel grid. Max's spawn is his foot position. Base speeds are 48 walk and 88 run; full jump height is about 27 pixels. Collision types are `solid`, one-way `platform`, and non-colliding `decor`. `inset` moves the collision top down inside the piece.

Example `edit_level` arguments:

```json
{"revision":0,"operations":[{"type":"block","id":"floor","x":-80,"y":0,"width":160,"height":12},{"type":"spawn","x":0,"y":0}]}
```

Artwork and collision remain independent. `role` is `platform`, `background`, or `decoration`; applying artwork does not change `kind`, positions, sizes, rotation, crop, or collision masks. Set `artwork: null` to restore a shape’s original visual source. `asset` with an asset id and `changes` can update its name, `selectedForGeneration`, or `sheet` metadata.

Other operations: `place` with an existing assetId; `update` with an id and changes containing x/y/w/h/rotation/kind/inset/flip/name/locked/opacity; `duplicate` with id and dx/dy; `delete` with ids; `rename` with name. Use `order` with id and direction (`front`, `back`, `forward`, `backward`) to move layers. Use `crop` with id and `rect: {x,y,w,h}` in the piece’s local displayed pixels; `reset: true` restores the source. Opacity ranges from 0 to 1. Unlock a piece with `update` and `locked: false` before transforming or deleting it. Assets can be imported through the editor or `import_image`; pixels are preserved unless processing options are requested.

Use `simulate_player` with route segments such as `{"seconds":0.4,"axis":1,"jump":true,"run":true}` to check a proposed jump. Tests are limited to ten seconds per request. The simulator covers Max's base movement and terrain collisions, not the full game's enemies, gardening or class perks.

MCP room files are persisted by the host. Save downloads a standalone JSON project; Export ZIP includes the named PNGs and placed level artwork. Agent links allow edits, so share them only with agents you intend to control this level.


## Sketch → artwork → original shapes

The user authors the spatial structure. Mint marks walkable platforms, blue background, orange decoration. Use semantic `role` independently of collision `kind`. Preserve all authored geometry, spawn, invisible collision masks and shapes outside a selected region.

1. Read `get_level` once. It includes selected reference sheets, semantic roles, artwork attachments and prepared request IDs without PNG data.
2. Call `prepare_artwork` with the revision and optional `objectIds` for a region, `assetIds` to override selected sheets, and a visual `prompt`. It freezes the semantic shapes, framing and reference identity as an editable request. Set `includeImages: true` for the actual generation handoff. The response contains the request manifest, then the semantic clownmap PNG, then reference sheet PNGs in manifest order. Otherwise only metadata is returned.
3. Give the map, manifest instructions and selected sheets together to an image generator. Request one coherent full-map PNG at the indicated dimensions and framing. Preparing a request does not generate an image. The embedded text chat does not supply image generation; external ChatGPT can generate from the handoff.
4. Call `apply_artwork` with the latest revision, `requestId`, and the returned PNG as `dataUrl` or an imported `assetId`. The editor maps the entire treatment automatically to its original shapes and clips it to their silhouettes. One operation is one undo step. The PNG remains an editable source asset; geometry and unrelated shapes remain unchanged. Changed target geometry rejects application rather than placing stale artwork.

A saved request can be retrieved by `get_artwork_request`; `includeImages: true` regenerates the same semantic map from its snapshot. Never manually reconstruct a level from generated sprites. Use a canvas preview only when visual verification would resolve uncertainty.

## Apply existing sheets directly

Use `apply_asset_sheet` when suitable pixels already exist. It neither generates nor duplicates assets. Supply `assetId` for one sheet, or `assetIds` to batch selected sheets with their semantic `sheet.role` assignments. `objectIds` limits the treatment to a region. Default tile size is 16 px. For an arbitrary atlas, inspect the source once and provide role rectangles:

```json
{"revision":4,"assetId":"forest-sheet","roles":{"platform":{"x":0,"y":0,"w":48,"h":48,"mode":"terrain"},"background":{"x":48,"y":0,"w":16,"h":16,"mode":"tile"},"decoration":{"x":64,"y":0,"w":16,"h":32,"mode":"stretch"}}}
```

`terrain` uses a square 3×3 patch (corners, edges, center) with adjacency-aware interior edges. `tile` repeats a source region at native scale, and `stretch` fits a decoration to its authored silhouette. A sheet’s role controls which shapes it treats. Do not assume every imported image uses a terrain layout: inspect unfamiliar sheets and choose valid source rectangles. All selected shapes are treated atomically; one undo restores their previous appearance.

## Editable sheet hierarchy

`group_sprite_sheet` keeps the original PNG and adds a character/environment sheet containing groups and stable frames. Omit slicing settings to recognize the image automatically: repeated poses become animation rows, while mixed-size regions become an environment atlas. Recognition tolerates flat-background JPEG noise and uneven spacing. Legacy numeric overrides remain available for exact known grids. Row grouping is the default. Column and manual grouping are supported. Blank frames are retained by default, including their row/column positions.

`inspect_sprite_sheet` returns groups and frame IDs without source bytes or every frame rectangle; `includeFrames: true` exposes precise source rectangles, and `includeImage: true` includes the source PNG. `edit_sprite_sheet` batches operations such as `rename_group`, `reorder_groups`, `reorder_frames`, `merge_groups`, `split_group`, and `group_frames` without changing the original image. `export_sprite_sheet` returns the arranged full sheet or a chosen `groupId` or `frameId` as an exact PNG. Each sheet edit is one reversible operation.

## Group workspace sprites without copying them

`group_workspace_sprites` accepts ordered `assetIds` (including repeated sources for repeated frames) or selected placed `objectIds`. Object positions infer rows, columns, padding and empty slots; transforms must use a common unrotated source scale. The result is one virtual parent sheet containing groups and stable frame references. Original raster sources remain stored once. The parent has no duplicate PNG. `get_asset_image` and export compose a PNG only when requested. Use `original: true` to inspect a raster sheet’s untouched source.

`ungroup_sprite_sheet` releases source sprites in one undo step; a virtual parent still used by the level is rejected. `edit_sprite_sheet` additionally supports `group_settings` with `fps`, `loop` and common `origin`, `replace_frame` with an artwork source rectangle, and `replace_group` with one rectangle per frame. Null replacement restores a frame’s original source. Grouping metadata and animation timing remain editable.

Images imported by `import_image` or the Assets workspace recognize structure automatically, without a grid configuration step or duplicate files. Character sheets retain every frame cell, including detached effects and empty positions. Irregular environment sheets use native source rectangles (`layout: "atlas"`), grouped by spatial rows. Set `autoGroup: false` for a plain source or supply `sheetType` only to override the inferred type. Uncertain images remain whole. Full atlas exports retain original source dimensions; selected regions export at native size. Group, rename, merge, split and undo operate on references to the preserved source. The default tile size for applying environment artwork remains 16 px.

## Iterate a sheet, group or frame selection

`prepare_asset_artwork` freezes a target `assetId` and optional `groupId` or `frameIds`. It returns exact target frame IDs, placements, shared origin, dimensions and generation instructions. `includeImages: true` returns the target PNG followed by selected visual references. A reference asset’s `referenceSelection: {groupIds?, frameIds?}` limits both the image and metadata to those groups/frames; it does not change the parent sheet.

Pass a returned PNG to `apply_asset_artwork` using its saved `requestId` and the latest revision. The treatment is stored once beneath its parent and attached to the intended frame IDs automatically. Original raster sources, frame order, grouping, timing, blank cells and unrelated frames remain editable. This is one undo step. Changed target layout rejects stale application. `get_asset_artwork_request` retrieves the saved handoff with metadata only by default.

Routine reads and patches omit image bytes. Metadata-only changes refer to their existing source using a SHA-256 guard, so rename/reorder actions and undo history do not repeatedly store or transmit PNGs. Source changes and additions still retain the pixels required to undo them.
