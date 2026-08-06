import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";

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
const videoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      await sleep(3000);
      file = await ai.files.get({ name: file.name });
    }
    if (file.state !== "ACTIVE") {
      throw new Error(`Gemini file processing ended in state ${file.state}`);
    }

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: createUserContent([
        createPartFromUri(file.uri, file.mimeType),
        HIGHLIGHT_REEL_PROMPT,
      ]),
    });

    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("highlight-reel error:", err.message);
    res.status(502).json({ error: "Gemini couldn't analyze this video" });
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

    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt });
    const reply = response.text?.trim();
    if (!reply) throw new Error("Empty response from Gemini");
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(502).json({ error: "Gemini request failed" });
  }
});

app.post("/api/training-tips", async (req, res) => {
  const { focus } = req.body;
  if (!focus || typeof focus !== "string") {
    return res.status(400).json({ error: "focus is required" });
  }
  try {
    const prompt = `You are a professional youth soccer coach. A player wants to improve on: "${focus}". Respond with ONLY minified JSON in the form {"drills":["...","..."]} — 3-5 specific, actionable training drills or tips for this, each one short (max 20 words). No markdown, no commentary.`;

    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt });
    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("training-tips error:", err.message);
    res.status(502).json({ error: "Gemini couldn't generate tips" });
  }
});

app.post("/api/monthly-checkin", async (req, res) => {
  const { reelCount, credits, improve } = req.body;
  try {
    const creditsText = (Array.isArray(credits) ? credits : []).join("; ") || "no reels analyzed yet";
    const improveText = (Array.isArray(improve) ? improve : []).join("; ") || "no reels analyzed yet";
    const prompt = `You are an encouraging youth soccer coach doing a monthly check-in with a player. This session they've generated ${reelCount || 0} highlight reel(s). Things they've done well across those reels: ${creditsText}. Areas they're working on: ${improveText}. Respond with ONLY minified JSON in the form {"message":"...","goals":["...","..."]} — a warm, specific 3-5 sentence check-in message reflecting on their progress, plus 2-3 concrete goals for next month. No markdown, no commentary.`;

    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt });
    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("monthly-checkin error:", err.message);
    res.status(502).json({ error: "Gemini couldn't generate a check-in" });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ error: "File too large for AI analysis" });
  }
  console.error(err);
  res.status(500).json({ error: "Unexpected server error" });
});

const clientDir = path.join(__dirname, "..", "client");
app.use(express.static(clientDir));
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "ClipKick.dc.html")));

app.listen(PORT, () => {
  console.log(`ClipKick running at http://localhost:${PORT}`);
});
