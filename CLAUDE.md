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
  - **Profile** (`profile`) — editable name/position/team, plus stats derived from `reelHistory` (reels generated, moments captured, etc.).
  - **Schedule** (`schedule`) — a static mock list of upcoming matches with an RSVP toggle; the one view with no AI and no PRD basis, purely there for "doesn't need to be all that special" liveliness.
- **Persistence: browser-local only, via `localStorage`** (`STORAGE_KEY = "clipkick-state-v1"`, `saveState()`/`loadState()`). `profile`, `reelHistory`, `coachMessages`, and each match's `rsvped` flag survive a page reload on the same browser/device. Still **not** a real multi-user backend — no accounts, nothing server-side, nothing synced across devices; it's `localStorage` on whichever browser you're in. `loadState()` runs first thing in `init()`. Every mutation site calls `saveState()` explicitly (reel completion, profile field edits, chat send, RSVP toggle) — there's no automatic/reactive persistence, so a new state mutation needs its own `saveState()` call.
- Output for Highlight Reel is real analysis (title, duration estimate, timestamped moments, credits, improvement notes) **plus** an actually-cut video: `buildHighlightVideo()` in `server/server.js` uses `ffmpeg-static` to trim a short clip around each identified moment and concatenate them into one mp4, served from `/reels/*`. Gemini supplies the timestamp list; ffmpeg does the actual cutting.
- **Sound effects**: synthesized in-browser via Web Audio oscillators (`sfx.click/send/notify/success/error` in the `<script>`) — no audio files, nothing to host. Muteable via the speaker icon in the topbar (`toggleSound()`, `soundEnabled`).
- **Visual design**: animated canvas orb (`startOrb()`) drives both the highlight-reel processing screen and the voice coach panel; subtle ambient gradient animation behind the whole app (`body::before`).
- **Coach Chat has two modes**: the original text chat (unchanged, still `POST /api/chat`) and a real-time **voice mode** (mic icon next to the chat input) — see Voice Coach below. Ending a voice call returns you to the text panel; navigating away from Coach Chat while a voice call is active ends it automatically (mic doesn't stay hot in the background).

## Backend (Gemini AI features)

- Run with `cd server && npm install && npm start` — serves the frontend AND the API on one origin (`http://localhost:3000` by default), so no CORS is involved.
- Requires `server/.env` with `GEMINI_API_KEY` set (copy `server/.env.example`). Never hardcode the key in `client/ClipKick.dc.html` — it was accidentally committed there once already and had to be rotated.
- Uses `gemini-3.6-flash` (see [Gemini API model docs](https://ai.google.dev/gemini-api/docs/models)), the current GA "balances speed with intelligence" Flash model — upgraded from the now-superseded `gemini-3.5-flash`. All four AI-backed routes share this one model constant (`GEMINI_MODEL` in `server/server.js`).
- **The current key is on Gemini's free tier, which shares one daily request quota across ALL routes combined.** Free-tier Flash limits are account/tier-specific and can shift over time — check the authoritative numbers at [AI Studio's rate-limit dashboard](https://aistudio.google.com/rate-limit) rather than trusting a hardcoded figure here. With four AI-backed endpoints sharing that quota, it's easy to burn through in a single testing session (confirmed firsthand — hit a 429 `RESOURCE_EXHAUSTED` mid-session). If features start failing with Gemini errors, check for a 429 in the server log before assuming a code bug. Upgrading to a paid Gemini API plan removes this ceiling.
- Routes in `server/server.js`:
  - `POST /api/highlight-reel` — accepts a `video` file (multipart, up to 500MB), uploads it to Gemini's Files API (upload + poll until `ACTIVE`, since match footage routinely exceeds the ~20MB inline-data limit), then asks Gemini for JSON `{title, duration, moments[], credits[], improve[]}`. Temp files are written to the OS tmpdir and deleted after the request (including on error, via `finally`).
  - `POST /api/chat` — `{message, history}` → `{reply}`, soccer-coach system prompt.
  - `POST /api/training-tips` — `{focus}` → `{drills[]}`.
  - `POST /api/monthly-checkin` — `{reelCount, credits[], improve[]}` → `{message, goals[]}`.
  - `WS /voice` — real-time voice coach, see below.

## Voice Coach (real-time audio)

- Backend is now an `http.Server` (not bare `app.listen`) with a `ws`-based `WebSocketServer` mounted at `/voice`, so the same port serves REST + the voice socket.
- `handleVoiceConnection()` in `server/server.js` opens a Gemini **Live API** session (`ai.live.connect`, model `GEMINI_VOICE_MODEL = "gemini-3.1-flash-live-preview"`, `responseModalities: [Modality.AUDIO]`) per browser connection and relays audio both directions — mic audio in from the client, spoken reply audio back out. This keeps the same "API key never reaches the browser" rule as every other route, just over a persistent stream instead of one request/response.
- Wire format between browser and our backend (not Gemini's own wire format — that's internal to the SDK): JSON messages, audio as base64. Client→server: `{type:"audio", data, mimeType:"audio/pcm;rate=16000"}` or `{type:"end"}`. Server→client: `{type:"ready"}`, `{type:"audio", data, mimeType:"audio/pcm;rate=24000"}`, `{type:"interrupted"}` (barge-in — client stops queued playback immediately), `{type:"turnComplete"}`, `{type:"error", error}`, `{type:"closed"}`.
- Client side (`startVoiceChat()`/`endVoiceChat()`/`playVoiceChunk()` in the `<script>`): captures mic via `getUserMedia` + a 16kHz `AudioContext` + `ScriptProcessorNode` (deprecated API, kept deliberately for simplicity/compatibility over `AudioWorklet` — revisit if it ever actually breaks), converts Float32 → Int16 PCM, streams over `WebSocket` to `${API_BASE}/voice` (protocol auto-switches `ws`/`wss` off `API_BASE`). Playback uses a second 24kHz `AudioContext` with a scheduled-queue pattern (`voiceNextPlayTime`) for gapless streaming audio.
- Tested with a real WebSocket client and with Chromium's fake-audio-device flow (`--use-fake-device-for-media-stream`) — confirmed the full connect → stream → clean-teardown path with zero errors. **Not yet confirmed with actual human speech** (only synthetic silence/tone, which correctly produced no reply) — the first real spoken conversation is still an open test.
- Voice conversations are **not** added to `coachMessages` / not persisted — only the text chat has a saved transcript.

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
- `showToast(msg, onClick?)` — used for every real error path, plus the "your reel is ready" cross-page notification; optional `onClick` makes it tappable (used to jump back to the reel).
- `saveState()` / `loadState()` — `localStorage` persistence, see Current State above. Call `saveState()` after any new mutation to user data or it won't survive a reload.
- `sfx.click/send/notify/success/error()`, `toggleSound()` — synthesized sound effects.
- `startOrb(canvas, opts)` — shared animated-orb renderer (processing screen + voice panel both use it); returns a stop function, always cancel the previous one before starting a new one on the same canvas or you leak a `requestAnimationFrame` loop.
- `startVoiceChat()` / `endVoiceChat()` — Voice Coach start/teardown (mic, WebSocket, both AudioContexts).

## Deployment

Split hosting: **Netlify** (static frontend) + **Railway** (Express backend, incl. the `/voice` WebSocket — needs a real long-running Node process, not serverless functions).

- Frontend: `https://clipkick-your-highlight-reels-begin-here.netlify.app` — deployed via `netlify-cli deploy --prod --dir=client` run directly from this machine (no GitHub involved in the deploy path). Netlify site config lives in `client/_redirects` (routes `/` → `/ClipKick.dc.html`, since the file isn't named `index.html`).
  - This Netlify account had **SSO/team visitor-access gating on by default** for new sites (`sso_login`/`account_sso_login`), which shows a login wall to anyone visiting — had to be disabled via `netlify api updateSite --data '{"site_id":"...", "body": {"sso_login": false}}'` (no CLI flag for this, dashboard is Site settings → Security, or the raw API). If a future redeploy or new Netlify site ever shows an unexpected "Login Redirect" page, this is why — check that setting first.
- Backend: `https://clipkick-api-production.up.railway.app` — deployed via `railway up --service <id>` from `server/`, same "direct from local machine" approach. `GEMINI_API_KEY` is set as a Railway service variable (not in git). Creating/viewing the public domain and listing variable values are both blocked for the agent by the Claude Code auto-mode safety classifier (publishing something publicly / surfacing a secret) — a human has to run those specific commands.
- `client/ClipKick.dc.html`'s `API_BASE` is currently **hardcoded to the Railway URL above**, not empty — meaning the deployed frontend always talks to the deployed backend, never to `localhost:3000`, even if you're running the server locally too. Swap it back to `""` only if you're intentionally testing same-origin local dev end-to-end.
- **GitHub is stale and not part of this deploy path** — `origin/main` (`Sidraja1007/ClipKick`) is still sitting on the very first commit; every commit since (split-hosting prep, auto-cut video, today's model/redesign/voice/persistence work) exists only in the local `main` branch. `git push` fails from this sandboxed environment (no GitHub credentials available to it) — pushing has to happen from a real terminal on the user's machine. Don't assume GitHub reflects current code.

## Working in this repo

- Preview via `cd server && npm install && npm start`, then open `http://localhost:3000` — the app doesn't work by opening `client/ClipKick.dc.html` directly (every AI feature needs the backend). Note `API_BASE` is currently hardcoded to production (see Deployment) so local preview actually talks to the live Railway backend, not a local one, unless you temporarily blank it out.
- Keep new frontend functionality inline in `client/ClipKick.dc.html` unless the project grows enough to justify splitting further — ask before making that call.
- No tests, linter, or CI configured — verify by starting the server and clicking through the affected view(s). For anything hitting Gemini, watch for 429s in the server log given the free-tier daily cap above — a failed request isn't necessarily a code bug.
- When testing in a headless/automated browser, screenshots taken immediately after a `navigate()` click can catch the CSS transition (150ms nav color) or `.view` fade-in (250ms) mid-flight and look broken when they aren't — add a short wait before asserting on a screenshot. For the voice coach specifically, Chromium's `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` flags auto-grant mic permission and feed a fake audio device, which is enough to verify the connect/stream/teardown path — it will not produce a spoken reply (no real speech content), so don't read silence from Gemini as a bug.
- If the user asks for lineups/links/general-chat/connections/a media library back, that's a scope change from the current direction — confirm before rebuilding rather than assuming it's wanted (there's a pre-pivot snapshot in `.backup-pre-soccer-pivot/` if useful as a reference).
