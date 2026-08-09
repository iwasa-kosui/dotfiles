---
name: rpt
description: Use when the user asks to create, update, build, or preview a report, 報告書, HTML report, or MDX report with rpt, including requests to make results viewable on a phone.
---

# rpt Reports / レポート

Create a safe, editable MDX source and build one shareable HTML report.

## Workflow

1. Extract purpose, audience, decision, source material, and output location. Ask one question only when a missing answer materially changes the report; otherwise make a stated assumption.
2. Gather only the requested evidence. Browse when freshness, citations, or the request requires it.
3. Run `rpt` without arguments. Treat stdout as the authoritative authoring contract. Do not rely on remembered component or HTML syntax.
4. Write the editable `.mdx` source. Use rich components only when they improve comprehension.
5. Run `rpt build <input.mdx> -o <output.html>`. For exit code 3, fix the reported input location without weakening the content. For exit code 4, rerun with `--debug` and diagnose the runtime; never bypass validation.
6. Verify both files exist, then return clickable absolute paths for the HTML and MDX. Mention the pinned-CDN requirement when Mermaid is present.

## Error handling

If `rpt` is unavailable, report that installation or `chezmoi apply` is required. If the authoring contract cannot be read, stop instead of guessing MDX syntax. Fix input diagnostics directly; never disguise forbidden scripts, expressions, attributes, URLs, or CSS.

## Mobile preview

Copy only the generated HTML to `index.html` inside a dedicated preview directory. Serve that directory on `0.0.0.0`, then run `mobile-preview-url <port>`. Never serve `/private/tmp`, a repository, a home directory, or a directory containing unrelated files.

If the phone sends TLS bytes to the HTTP server, provide the Meshnet IP URL with an explicit `http://` scheme.

## Handoff

Return the report title, HTML path, MDX path, source caveats, and preview URL when requested. Keep the server running until the user is done.
