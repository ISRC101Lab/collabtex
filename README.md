# CollabTeX

A minimal, self-hosted, Overleaf-like editor focused on the paper-writing loop:
**edit → compile → PDF preview**, with real-time collaboration and SyncTeX.

## What you get

- Real-time collaboration (Yjs + Hocuspocus).
- Project list, zip import, file tree, upload, rename/move/delete, set main file.
- Smart multi-pass LaTeX compile (pdfLaTeX/XeLaTeX/LuaLaTeX) + BibTeX/Biber.
- PDF preview (PDF.js), zoom/paging, click-to-source mapping.
- SyncTeX **source → PDF** (toolbar button) and **PDF → source** (click inside PDF).
- Optional one-click **AI compile fix** (server-side Codex CLI).
- Local accounts only (no open registration).

## Quick start

```bash
cd collabtex
npm install
npm run build
./run.sh
```

Open: `http://localhost:3080`

Default users:
- `admin`
- `user01` .. `user09`

Default password (change in production):
- `ChangeMe!2026`

## Docs

- User guide: `docs/USER_GUIDE.md`
- Admin guide: `docs/ADMIN_GUIDE.md`
- Video script (recording plan): `docs/VIDEO_SCRIPT.md`
- Example projects: `examples/`

## Run options

### tmux (recommended)

```bash
tmux new-session -d -s collabtex \
  'cd /path/to/collabtex && \
   DATA_DIR=/path/to/collabtex/collabtex-data \
   WEB_HOST=0.0.0.0 WEB_PORT=3080 \
   WS_HOST=0.0.0.0 WS_PORT=3081 \
   INIT_PASSWORD=ChangeMe!2026 OPEN_ACCESS=0 FILE_UMASK=077 \
   node server/index.js'
```

### Foreground (debug)

```bash
INIT_PASSWORD='ChangeMe!2026' WEB_PORT=3080 WS_PORT=3081 node server/index.js
```

## Configuration

See `.env.example` for all environment variables. Common ones:

- `DATA_DIR`: data storage (default: `collabtex/collabtex-data`)
- `WEB_HOST/WEB_PORT`: HTTP bind host/port
- `WS_HOST/WS_PORT`: WebSocket bind host/port
- `OPEN_ACCESS`: 1 = any logged-in user can access any project
- `FILE_UMASK`: default file permission mask

## SyncTeX usage

- Source → PDF: place cursor in the editor and click **“同步 PDF”**.
- PDF → Source: click in the PDF preview to jump to the corresponding line.

Note: SyncTeX only works for lines included in the compiled document (not preamble-only lines).

## AI compile fix (optional)

Server-side one-click fix uses the **Codex CLI**. Set:

```bash
export OPENAI_API_KEY="..."
# optional
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-5.2-codex"
```

## Open-source readiness

This repo includes:
- `LICENSE` (MIT)
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- `docs/` user/admin guides and a video script

Before publishing, scrub any private data under `collabtex-data/`.

## Maintenance status

This is a **learning / practice** project. The author may not actively maintain it.
Community improvements are welcome, but please assume no guaranteed support or updates.

## Development

```bash
npm install
npm run build
node server/index.js
```

## License

MIT. See `LICENSE`.
