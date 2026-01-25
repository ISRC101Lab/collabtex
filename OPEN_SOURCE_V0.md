# CollabTeX v0 (Open Source Readiness)

This is a v0 snapshot for public release. It focuses on a clean, reliable paper-writing loop:
**edit → compile → PDF preview**, with collaboration and SyncTeX.

## Quick Start

```bash
cd collabtex
./run.sh
```

Open: http://localhost:3080

Default users:
- admin
- user01 .. user09

Default password (change in production):
- ChangeMe!2026

## Server‑Side AI (Codex CLI)

Optional one-click compile fixes use Codex CLI on the server. No client key required.

```bash
export OPENAI_API_KEY="..."
# optional overrides
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-5.2-codex"
```

## Features Included in v0

- Real‑time collaboration (Yjs + Hocuspocus)
- LaTeX compile pipeline with logs, diagnostics, and PDF preview
- **Codex‑powered** compile auto‑fix flow (server‑side, optional)
- SyncTeX: source → PDF (button) and PDF → source (click in preview)
- File tree with filters, grouping, multi‑select, delete/rename/move
- Zip import with main file auto‑detect and warnings
- ACM / AI conference templates

## Known Limitations (v0)

- AI compile fix requires server key.
- SyncTeX depends on successful compile artifacts.
- Large projects can still be slower to compile.

## Release Checklist

- [x] Scrub any private data under `collabtex-data/` (moved to `collabtex-data.local/`)
- [ ] Set real admin password in production
- [x] Provide a sample project in `examples/`
- [x] ACM template example added in `examples/acm-sigconf/`
- [x] Confirm license and docs are present
