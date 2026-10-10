# Pixel Mill plugin update source

These files overlay the existing private plugin `plugins_6ab4fd44ca088191a56acaeb56863713`; they are not a standalone installable package. Its existing App connection, MCP configuration and binary icons remain owned by the published plugin and must be preserved. Retrieve the current release before publishing another update and use its release ID as the update precondition.

Source version: 0.1.9. Adds private Supabase storage and explicit recovery instructions for cached legacy projects. Database create, reopen, concurrent merging, idempotent retries, conflicts and MCP sessions were verified against the deployed storage service. Figma desktop installation is not verified by the harness.
