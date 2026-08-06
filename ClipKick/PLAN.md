# ClipKick — First Functional Prototype: Implementation Plan

## Scope decisions (confirmed with user)

- **Backend**: add a minimal Node/Express server — this is a real architectural jump from the current "single static HTML file" state, so the repo structure changes (see Phase 0).
- **Media**: real files. Uploads are read via the File API, sent to the server, stored on disk, and served back for genuine playback in the Watch view (not a simulated progress bar / fake player).
- **Chat/Connections**: single-user simulation stays. One logged-in user ("JR"), fixed contacts/threads — but all of it now reads/writes through the backend instead of in-memory arrays, so it persists across reloads.
- **Auth**: out of scope for this prototype. Still a single hardcoded user, no login screen. Flagged as a likely next phase after this one.

This crosses the threshold CLAUDE.md flags ("ask before adding a build step") — Phase 0 covers restructuring and CLAUDE.md gets updated once this lands.

## Target architecture

```
/client
  ClipKick.dc.html      <- same file, script now calls fetch() instead of reading local arrays
/server
  index.js              <- Express app: serves /client static + REST API + uploaded files
  db.js                 <- SQLite connection + schema/migrations
  db/clipkick.sqlite     <- gitignored, generated at first run
  uploads/               <- gitignored, real uploaded file blobs
  package.json
.gitignore              <- node_modules, server/db/*.sqlite, server/uploads/*
```

Single Express server serves both the static frontend and the API on one origin — avoids CORS entirely and keeps "open one thing and it works" close to the current experience (`npm start` instead of double-clicking the HTML file).

## Phase 0 — Project scaffolding

1. Create `/server` with its own `package.json` (Express, better-sqlite3, multer, nanoid/uuid).
2. Move `ClipKick.dc.html` into `/client/` unchanged (no logic changes yet — just relocate).
3. `server/index.js`: static-serves `/client`, mounts API routes under `/api`, serves uploaded files under `/media/:filename`.
4. Add `.gitignore` for `node_modules/`, `server/db/*.sqlite`, `server/uploads/*`.
5. Verify: `npm install && npm start` in `/server` serves the untouched frontend at `localhost:PORT` exactly as it looks today.

## Phase 1 — Data layer

1. Design SQLite schema mirroring the six current in-memory arrays, with real relationships:
   - `lineups(id, name, desc, colors_json, created_at)`
   - `media_items(id, name, type, size_bytes, file_path, lineup_id NULL, created_at)` — replaces `uploads`; a lineup's item count/thumbnail stack derives from this table
   - `links(id, title, url, favicon, lineup_id NULL, created_at)`
   - `connections(id, name, initials, color, role, shared_count)`
   - `chats(id, connection_id, preview, updated_at)`
   - `messages(id, chat_id, from, text, media_ref NULL, created_at)`
2. Write a seed script that inserts the exact demo data currently hardcoded in the `<script>` block, so first run isn't empty.
3. Verify: inspect the sqlite file directly (`sqlite3 server/db/clipkick.sqlite ".tables"` / a few `select *`) to confirm schema + seed data match.

## Phase 2 — Core CRUD APIs (no file upload yet)

1. `GET/POST/DELETE /api/lineups`
2. `GET/POST /api/links`, `DELETE /api/links/:id`
3. `GET/POST /api/connections`, `DELETE /api/connections/:id`
4. Wire the frontend's `init()` to `fetch()` these on load instead of reading local arrays; keep render functions as-is, just change the data source.
5. Wire the currently-toast-only actions to real calls: "+ New lineup" (prompt for name → POST → re-render), "+ Save link" (prompt/form for URL → POST → re-render), Connect "+ Invite" and per-card actions.
6. Verify: create/delete a lineup, a link, and a connection; reload the page; confirm the change survived (proves persistence, not just in-memory mutation).

## Phase 3 — Real file uploads

1. `POST /api/uploads` (multipart via multer) — stores the file under `server/uploads/`, infers `type` from mimetype, writes a `media_items` row, returns the created record.
2. `GET /api/uploads` — list all media items.
3. Serve stored files statically at `/media/:filename` so they're directly playable/previewable.
4. Rewire the Upload view: drag-and-drop and "Choose files" now read real `FileList`, POST each file with `XMLHttpRequest` (for real upload-progress events feeding the existing `.progress-bar`), then refresh the upload list from the API.
5. Verify: drop a real video file and an image, confirm the file physically lands in `server/uploads/`, confirm the metadata row appears in the upload list with correct size/type after a reload.

## Phase 4 — Real playback (Watch view)

1. Replace the decorative `.player-bg` gradient with an actual `<video>` (or `<audio>` for audio-typed items) element whose `src` points at `/media/:filename`.
2. Build the "Up next" queue from real `media_items` of type video/audio (most recent first, or filtered by current lineup) instead of the hardcoded `queue` array.
3. Wire play/pause to the real media element's `.play()`/`.pause()`, and the timeline UI to `currentTime`/`duration` (`timeupdate` listener), replacing the fake icon-toggle-only behavior.
4. Clicking a queue item sets the player's real `src` and title/duration from that item's actual metadata.
5. Verify: upload two short video clips, confirm both play back correctly, confirm switching between them in the queue actually swaps the video and duration display.

## Phase 5 — Lineups as real containers

1. Add a lightweight "assign to lineup" affordance on upload (a `<select>` in the upload list item) and on save-link (same in the save-link form) that PATCHes `media_items.lineup_id` / `links.lineup_id`.
2. Clicking a lineup card opens a simple detail view (reuse `.content` panel or a modal) listing that lineup's real media items and links, instead of just firing a toast.
3. Lineup thumbnail "stack" and item count on cards become derived from real child counts, not the hardcoded `colors`/`count` fields.
4. Verify: assign an uploaded clip to a lineup, open that lineup, confirm the clip shows up; confirm the home/lineups grid counts update.

## Phase 6 — Chat wired to backend

1. `GET /api/chats`, `GET /api/chats/:id/messages`, `POST /api/chats/:id/messages`.
2. Clicking a chat-list item actually switches the active thread (currently it doesn't — only styles `.active`), loading that thread's real messages.
3. `sendMessage()` POSTs to the backend for the active chat and re-fetches instead of pushing into a local array.
4. "Share" on a Connection card becomes real: pick one of the user's lineups, POST a message with a `media_ref` into that connection's chat thread.
5. Verify: send a message, reload, confirm it persisted; switch chat threads and confirm each shows its own distinct history; share a lineup from Connections and confirm it appears as a message.

## Phase 7 — Search

1. `GET /api/search?q=` across lineups/media_items/links names, or simpler: fetch all three lists once and filter client-side (fine at this scale).
2. Wire the topbar `#searchInput` (currently decorative) to filter the currently-visible view's rendered list on keystroke.
3. Verify: typing a lineup name filters the lineups grid; typing a filename filters uploads.

## Phase 8 — Cleanup & handoff

1. Sweep remaining `showToast`-only stubs (Invite, some Connect actions) — either give them real backend actions or leave clearly marked as future scope, but don't leave silently-fake ones that look identical to the real actions built above.
2. Add basic fetch error handling (failed request → error toast) so failures aren't just a Console silence.
3. Update `CLAUDE.md`: new project structure (`/client`, `/server`), how to run (`cd server && npm install && npm start`), and remove the now-inaccurate "no fetch, no backend" claims.
4. Manual pass: click through all seven views end-to-end confirming no leftover mocked behavior contradicts the new real one.

## Explicitly deferred (not this prototype)

- Real authentication / multi-user accounts.
- Real-time chat (websockets) — not needed since chat stays single-user simulation.
- File type validation/limits, virus scanning, storage quotas (the "Free Plan" badge stays decorative).
- Production deployment/hosting concerns.
