import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { GoogleGenAI, createUserContent, createPartFromUri, PartMediaResolutionLevel } from "@google/genai";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = "gemini-3.5-flash";

if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY — set it in .env before starting the server.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Match footage is typically far bigger than the ~20MB inline-data limit, so this
// route uploads to disk and hands Gemini's Files API a path instead of base64 bytes.
// 2GB matches Gemini Files API's actual per-file cap — no point capping tighter than that.
const videoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Gemini calls occasionally throw a transient 503 (model overloaded) or 429
// (rate limit) that clears up within seconds — retry those instead of failing
// the whole highlight reel over a blip.
async function generateWithRetry(config, retries = 2, baseDelayMs = 1500) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(config);
    } catch (err) {
      const retryable = /"code":\s*(503|429)|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(err.message || "");
      if (!retryable || attempt >= retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

// Turns a raw Gemini SDK error into a message that actually tells the user
// (and us) what happened, instead of one generic "request failed" for every case.
function reasonForGeminiError(err, fallback) {
  const msg = err.message || "";
  if (/"code":\s*503|UNAVAILABLE/.test(msg)) return "Gemini is temporarily overloaded — please try again in a moment.";
  if (/"code":\s*429|RESOURCE_EXHAUSTED/.test(msg)) return "Gemini's free-tier request limit has been reached for now — try again later.";
  return fallback;
}

// Generated highlight-reel videos are served from here (same "no persistence
// beyond this process" pattern as the rest of the app — nothing writes to disk
// long-term on purpose).
const reelsDir = path.join(os.tmpdir(), "clipkick-reels");
fs.mkdirSync(reelsDir, { recursive: true });

function parseTimeToSeconds(t) {
  const parts = String(t).split(":").map(Number).filter(n => !Number.isNaN(n));
  if (!parts.length) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const CLIP_LEAD_IN_SEC = 2; // start each clip slightly before the flagged moment
const CLIP_LENGTH_SEC = 8; // total length per clip

// Cuts a short clip around each identified moment, then stitches them into one
// mp4 — this is the actual "make me a shorter video" step; Gemini only supplies
// the timestamp list, it can't produce video itself.
async function buildHighlightVideo(sourcePath, moments) {
  if (!moments.length) return null;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipkick-clip-"));
  try {
    const clipPaths = [];
    for (let i = 0; i < moments.length; i++) {
      const start = Math.max(0, parseTimeToSeconds(moments[i].time) - CLIP_LEAD_IN_SEC);
      const clipPath = path.join(workDir, `clip-${i}.mp4`);
      await execFileAsync(ffmpegPath, [
        "-ss", String(start),
        "-i", sourcePath,
        "-t", String(CLIP_LENGTH_SEC),
        // Stream copy instead of re-encoding: near-instant per clip instead of
        // seconds of transcoding. Trade-off is the cut snaps to the nearest
        // keyframe rather than the exact second — fine given Gemini's
        // timestamps are already approximate, and speed matters more here.
        "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart",
        "-y", clipPath,
      ]);
      clipPaths.push(clipPath);
    }

    const listPath = path.join(workDir, "list.txt");
    fs.writeFileSync(listPath, clipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

    const outputName = `reel-${Date.now()}.mp4`;
    const outputPath = path.join(reelsDir, outputName);
    await execFileAsync(ffmpegPath, [
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-movflags", "+faststart",
      "-y", outputPath,
    ]);
    return `/reels/${outputName}`;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function extractJson(text) {
  const cleaned = (text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

const HIGHLIGHT_REEL_PROMPT = `You are an expert soccer video analyst and highlight editor. The user has provided a full soccer match or training video of themselves playing. Analyze the video to identify the player's best moments, including goals, assists, successful dribbles, tackles, saves, key passes, and other standout plays.

Respond with ONLY minified JSON in the form {"title":"...","duration":"m:ss","moments":[{"time":"m:ss","label":"..."}],"credits":["...","..."],"improve":["...","..."]}:
- title: a short catchy highlight-reel title for this footage (max 8 words)
- duration: your best estimate of the clip's total length, formatted m:ss
- moments: the best moments selected for the reel in chronological order, each with an approximate timestamp (m:ss) and a short label (max 8 words) — this is the timestamp list of clips selected for the highlight reel
- credits: 2-4 short, specific things the player did well
- improve: 1-3 short, specific things the player can work on for next time
No markdown, no commentary.`;

app.post("/api/highlight-reel", videoUpload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "video is required" });
  const tempPath = req.file.path;
  try {
    let file = await ai.files.upload({
      file: tempPath,
      config: { mimeType: req.file.mimetype },
    });

    while (file.state === "PROCESSING") {
      await sleep(1500);
      file = await ai.files.get({ name: file.name });
    }
    if (file.state !== "ACTIVE") {
      throw new Error(`Gemini file processing ended in state ${file.state}`);
    }

    const response = await generateWithRetry({
      model: GEMINI_MODEL,
      contents: createUserContent([
        // Low media resolution cuts per-frame token cost ~4x — faster analysis
        // and lets much longer match footage fit within the model's context.
        createPartFromUri(file.uri, file.mimeType, PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW),
        HIGHLIGHT_REEL_PROMPT,
      ]),
    });

    const parsed = extractJson(response.text);

    let videoUrl = null;
    try {
      videoUrl = await buildHighlightVideo(tempPath, Array.isArray(parsed.moments) ? parsed.moments : []);
    } catch (clipErr) {
      console.error("highlight video build error:", clipErr.message);
    }

    res.json({ ...parsed, videoUrl });
  } catch (err) {
    console.error("highlight-reel error:", err.message);
    const fallback = /processing ended in state/.test(err.message || "")
      ? "This video couldn't be processed — try a standard MP4 or MOV export."
      : "Gemini couldn't analyze this video — try again.";
    res.status(502).json({ error: reasonForGeminiError(err, fallback) });
  } finally {
    fs.unlink(tempPath, () => {});
  }
});

const COACH_SYSTEM_PROMPT = `You are ClipKick Coach, an AI assistant for a youth soccer highlight-reel app. You talk to talented young soccer players who want to improve and get noticed by coaches/scouts. Be warm, encouraging, and specific — give real soccer knowledge (training, tactics, recovery, mindset), not generic filler. Keep answers to 2-4 sentences.`;

app.post("/api/chat", async (req, res) => {
  const { message, history } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const turns = (Array.isArray(history) ? history : [])
      .filter(m => m && typeof m.text === "string")
      .map(m => `${m.from === "me" ? "Player" : "Coach"}: ${m.text}`)
      .join("\n");
    const prompt = `${COACH_SYSTEM_PROMPT}\n\n${turns ? turns + "\n" : ""}Player: ${message}\nCoach:`;

    const response = await generateWithRetry({ model: GEMINI_MODEL, contents: prompt });
    const reply = response.text?.trim();
    if (!reply) throw new Error("Empty response from Gemini");
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(502).json({ error: reasonForGeminiError(err, "Coach couldn't reply — try again.") });
  }
});

app.post("/api/training-tips", async (req, res) => {
  const { focus } = req.body;
  if (!focus || typeof focus !== "string") {
    return res.status(400).json({ error: "focus is required" });
  }
  try {
    const prompt = `You are a professional youth soccer coach. A player wants to improve on: "${focus}". Respond with ONLY minified JSON in the form {"drills":["...","..."]} — 3-5 specific, actionable training drills or tips for this, each one short (max 20 words). No markdown, no commentary.`;

    const response = await generateWithRetry({ model: GEMINI_MODEL, contents: prompt });
    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("training-tips error:", err.message);
    res.status(502).json({ error: reasonForGeminiError(err, "Gemini couldn't generate tips — try again.") });
  }
});

app.post("/api/monthly-checkin", async (req, res) => {
  const { reelCount, credits, improve } = req.body;
  try {
    const creditsText = (Array.isArray(credits) ? credits : []).join("; ") || "no reels analyzed yet";
    const improveText = (Array.isArray(improve) ? improve : []).join("; ") || "no reels analyzed yet";
    const prompt = `You are an encouraging youth soccer coach doing a monthly check-in with a player. This session they've generated ${reelCount || 0} highlight reel(s). Things they've done well across those reels: ${creditsText}. Areas they're working on: ${improveText}. Respond with ONLY minified JSON in the form {"message":"...","goals":["...","..."]} — a warm, specific 3-5 sentence check-in message reflecting on their progress, plus 2-3 concrete goals for next month. No markdown, no commentary.`;

    const response = await generateWithRetry({ model: GEMINI_MODEL, contents: prompt });
    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("monthly-checkin error:", err.message);
    res.status(502).json({ error: reasonForGeminiError(err, "Gemini couldn't generate a check-in — try again.") });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ error: "File too large for AI analysis" });
  }
  console.error(err);
  res.status(500).json({ error: "Unexpected server error" });
});

app.use("/reels", express.static(reelsDir));

const clientDir = path.join(__dirname, "..", "client");
app.use(express.static(clientDir));
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "ClipKick.dc.html")));

app.listen(PORT, () => {
  console.log(`ClipKick running at http://localhost:${PORT}`);
});
