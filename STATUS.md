# Status (2026-01-25)

This file tracks current state and next steps for CollabTeX.

## Running state

- Service binds to `WEB_PORT=3080` and `WS_PORT=3081` by default.
- Recommended to run in a `tmux` session on servers.
- Data directory default: `collabtex/collabtex-data`.

Quick checks:

```bash
curl -I http://127.0.0.1:3080/api/me
ss -ltnp | rg ':3080|:3081'
```

## Current feature set (v0)

- Real-time collaboration (Yjs + Hocuspocus)
- LaTeX compile pipeline (smart multi-pass, pdfLaTeX/XeLaTeX/LuaLaTeX)
- PDF preview (PDF.js), zoom, page navigation
- SyncTeX: source → PDF (button) and PDF → source (click)
- File tree management: create/upload/rename/move/delete
- Zip import with main file auto-detect
- Optional one-click AI compile fix (Codex CLI)

## Known risks

- SyncTeX only works for lines included in the compiled document.
- Large projects may require higher compile limits.
- If Docker compile is enabled, missing TeX packages may cause failures.

## Next steps

1) Add automated smoke tests for compile + SyncTeX.
2) Optional: profile compile performance on large projects.

## Log locations

- `collabtex/server.log`
- `collabtex-data/projects/<id>/build/main.log`
