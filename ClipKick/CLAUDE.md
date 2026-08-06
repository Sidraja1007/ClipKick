# ClipKick

An AI-powered app for youth soccer players built around one core feature: upload a full match or training video, and ClipKick's AI finds the best moments (goals, assists, dribbles, tackles, saves), returns a timestamped clip list, and gives feedback (credits + areas to improve) — so players can send something coach/scout-ready without editing footage themselves.

Scoped from `ClapKick.md.pdf` (the PRD), then deliberately expanded on request ("make it more lively... 6 extra usual soccer features") into a small multi-view app. Still no lineups/links/connections/general media library — that's the earlier "personal media cloud" direction and stays out unless explicitly asked for again.

## Project structure

- `client/ClipKick.dc.html` — the entire frontend: one self-contained HTML file with inline `<style>` and `<script>`. No build step, no bundler, no framework.
- `server/` — minimal Node/Express backend (ESM, `@google/genai`) that proxies all Gemini calls so the API key never reaches the browser. See `server/server.js`.
- `.cursor/mcp.json` — MCP config pointing at Anthropic's design MCP server (`claude_design`), used for design-related tooling in Cursor/Claude Code. This is a design-tooling integration, not a hosting/deployment platform — it has nothing to do with how the app actually runs.
- `.backup-pre-soccer-pivot/` — a snapshot of the earlier "personal media cloud" version of the app (client + server), kept in case anything from that version is ever needed again. Not part of the running app.
- `PLAN.md` — leftover from the earlier, broader "personal media cloud" direction (SQLite persistence, real uploads/playback, connections/chat). Superseded by the PRD pivot; safe to ignore unless the user explicitly revives that direction.

## Current state

- Vanilla JS only on the frontend — no framework, no external JS libraries.
- Dashboard shell restored (sidebar + topbar, `navigate(view)` toggling `data-view`/`id="view-*"`), same pattern as the original pre-pivot ClipKick, but every view is soccer-specific:
  - **Highlight Reel** (`reel`, default) — the core PRD feature: upload → real Gemini analysis → title/timestamped moments/credits/improve. State machine `reelFlowState`: `idle` → `ready` → `processing` → `result`.
  - **My Reels** (`myreels`) — session history of every reel generated (`reelHistory` array); click a card to view it again; "Copy summary to share with a coach" copies a plain-text recap to the clipboard.
  - **Coach Chat** (`chat`) — free-form AI chat, soccer-coaching system prompt, real via `/api/chat`.
  - **Training Tips** (`tips`) — real via `/api/training-tips`; either type a focus area or pull it from the latest reel's `improve` notes.
  - **Check-In** (`checkin`) — real via `/api/monthly-checkin`; synthesizes a progress reflection + goals from all of `reelHistory`'s credits/improve notes.
  - **Profile** (`profile`) — editable name/position/team (in-memory), plus stats derived from `reelHistory` (reels generated, moments captured, etc.).
  - **Schedule** (`schedule`) — a static mock list of upcoming matches with an RSVP toggle; the one view with no AI and no PRD basis, purely there for "doesn't need to be all that special" liveliness.
- No persistence anywhere — `reelHistory`, `profile`, `coachMessages`, chat/tips/checkin results are all in-memory and reset on page reload.
- Output for Highlight Reel is analysis only (title, duration estimate, timestamped moments, credits, improvement notes) — **not** an actually-rendered/trimmed video file. Gemini can analyze video and return a timestamp list, but it can't itself cut/export a new video; that would need added video-editing infrastructure (e.g. ffmpeg) that doesn't exist yet. The UI says this explicitly.

## Backend (Gemini AI features)

- Run with `cd server && npm install && npm start` — serves the frontend AND the API on one origin (`http://localhost:3000` by default), so no CORS is involved.
- Requires `server/.env` with `GEMINI_API_KEY` set (copy `server/.env.example`). Never hardcode the key in `client/ClipKick.dc.html` — it was accidentally committed there once already and had to be rotated.
- **The current key is on Gemini's free tier, capped at 20 requests/day for `gemini-3.5-flash` across ALL routes combined.** With four AI-backed endpoints now sharing that quota, it's easy to burn through in a single testing session (confirmed firsthand — hit a 429 `RESOURCE_EXHAUSTED` mid-session). If features start failing with Gemini errors, check for a 429 in the server log before assuming a code bug. Upgrading to a paid Gemini API plan removes this ceiling.
- Routes in `server/server.js`:
  - `POST /api/highlight-reel` — accepts a `video` file (multipart, up to 500MB), uploads it to Gemini's Files API (upload + poll until `ACTIVE`, since match footage routinely exceeds the ~20MB inline-data limit), then asks Gemini for JSON `{title, duration, moments[], credits[], improve[]}`. Temp files are written to the OS tmpdir and deleted after the request (including on error, via `finally`).
  - `POST /api/chat` — `{message, history}` → `{reply}`, soccer-coach system prompt.
  - `POST /api/training-tips` — `{focus}` → `{drills[]}`.
  - `POST /api/monthly-checkin` — `{reelCount, credits[], improve[]}` → `{message, goals[]}`.

## Design tokens

Dark theme driven entirely by CSS custom properties in `:root` — reuse these, don't hardcode new colors:

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-elevated` / `--bg-card` / `--bg-hover` | `#0a0b0f` → `#1f2330` | surface layers, darkest to lightest |
| `--text` / `--text-muted` / `--text-dim` | `#f4f4f6` → `#5c6170` | text hierarchy |
| `--accent` / `--accent-soft` / `--accent-glow` | `#ff5c35` (+ alpha variants) | brand orange (CTAs, highlights) |
| `--success` | `#3dd68c` | positive state (credits) |
| `--blue` | `#5b8def` | secondary accent (improve-on items) |
| `--radius` / `--radius-sm` | `14px` / `10px` | corner rounding |
| `--sidebar-w` / `--nav-h` | `240px` / `64px` | layout dimensions |

Fonts: DM Sans (UI text), Instrument Serif italic (emphasis, e.g. the `<em>` in the hero headline).

## Key JS entry points

- `navigate(view)` — switches active nav item + view section, updates the topbar title, closes the mobile sidebar. Called by every `.nav-item` click handler.
- `renderReelFlow()` / `reelDetailHtml(reel)` — the highlight-reel state machine; `reelDetailHtml()` is shared between the live result view and My Reels detail view, so keep result markup changes in one place.
- `startReelProcessing()` — uploads to `/api/highlight-reel`; on success, pushes into `reelHistory` (this is what feeds My Reels, Profile stats, and Check-In/Training-Tips-from-latest-reel).
- `renderMyReels()` — grid of `reelHistory`, or an inline detail view keyed by `selectedReelId`.
- `shareReel(id)` — copies a plain-text reel summary to the clipboard via `navigator.clipboard`.
- `sendCoachMessage()` / `askCoach()` — Coach Chat, real via `/api/chat`.
- `getTrainingTips()` / `getTipsFromLatestReel()` — Training Tips, real via `/api/training-tips`.
- `getMonthlyCheckin()` — Check-In, real via `/api/monthly-checkin`.
- `renderProfile()` / `renderStats()` / `wireProfileInputs()` — Profile view; stats are recomputed from `reelHistory` on every render, not stored separately.
- `renderSchedule()` / `toggleRsvp(i)` — Schedule view, `upcomingMatches` is a static mock array.
- `showToast(msg)` — used for every real error path (any backend request failing).

## Working in this repo

- Preview via `cd server && npm install && npm start`, then open `http://localhost:3000` — the app doesn't work by opening `client/ClipKick.dc.html` directly (every AI feature needs the backend).
- Keep new frontend functionality inline in `client/ClipKick.dc.html` unless the project grows enough to justify splitting further — ask before making that call.
- No tests, linter, or CI configured — verify by starting the server and clicking through the affected view(s). For anything hitting Gemini, watch for 429s in the server log given the free-tier daily cap above — a failed request isn't necessarily a code bug.
- When testing in a headless/automated browser, screenshots taken immediately after a `navigate()` click can catch the CSS transition (150ms nav color) or `.view` fade-in (250ms) mid-flight and look broken when they aren't — add a short wait before asserting on a screenshot.
- If the user asks for lineups/links/general-chat/connections/a media library back, that's a scope change from the current direction — confirm before rebuilding rather than assuming it's wanted (there's a pre-pivot snapshot in `.backup-pre-soccer-pivot/` if useful as a reference).
