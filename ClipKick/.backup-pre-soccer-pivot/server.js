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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Match footage is typically far bigger than the ~20MB inline-data limit, so this
// route uploads to disk and hands Gemini's Files API a path instead of base64 bytes.
const videoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1$|0\.0\.0\.0$)/i;

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const CLIPKICK_SYSTEM_PROMPT = `You are ClipKick AI, the built-in assistant for ClipKick — a personal media cloud app whose tagline is "Your media. Your vision. No social noise." Users upload clips, organize them into "lineups" (playlists/albums), save links, watch content in a queue, connect with people, and chat about shared media — all without a public feed, likes, or algorithmic noise.

Reply as ClipKick AI: warm, sharp, and specific — never generic customer-support phrasing. Keep answers to 2-4 sentences. When it fits naturally, point to a concrete ClipKick action (e.g. "drop it in your Family Trips lineup" or "save that link and tag it to Cooking Recipes").`;

function extractJson(text) {
  const cleaned = (text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

app.post("/api/chat", async (req, res) => {
  const { message, history } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const turns = (Array.isArray(history) ? history : [])
      .filter(m => m && typeof m.text === "string" && m.text !== "…")
      .map(m => `${m.from === "me" ? "User" : "ClipKick AI"}: ${m.text}`)
      .join("\n");
    const prompt = `${CLIPKICK_SYSTEM_PROMPT}\n\n${turns ? turns + "\n" : ""}User: ${message}\nClipKick AI:`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const reply = response.text?.trim();
    if (!reply) throw new Error("Empty response from Gemini");
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(502).json({ error: "Gemini request failed" });
  }
});

app.post("/api/describe-clip", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  try {
    const base64 = req.file.buffer.toString("base64");
    const prompt = `Look at this media file named "${req.file.originalname}". Respond with ONLY minified JSON in the form {"title":"...","description":"...","tags":["...","..."]} — a short catchy title (max 8 words), a one-sentence description of what's actually in the file, and 2-4 lowercase single-word tags. No markdown, no commentary.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: req.file.mimetype, data: base64 } },
            { text: prompt },
          ],
        },
      ],
    });

    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("describe-clip error:", err.message);
    res.status(502).json({ error: "Gemini couldn't analyze this file" });
  }
});

app.post("/api/name-lineup", async (req, res) => {
  const { hint } = req.body;
  if (!hint || typeof hint !== "string") {
    return res.status(400).json({ error: "hint is required" });
  }
  try {
    const prompt = `A ClipKick user wants a new "lineup" (a playlist/album of personal media) about: "${hint}". Respond with ONLY minified JSON in the form {"name":"...","description":"..."} — a short catchy lineup name (max 4 words) and a one-sentence description. No markdown, no commentary.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("name-lineup error:", err.message);
    res.status(502).json({ error: "Gemini couldn't name that lineup" });
  }
});

app.post("/api/summarize-link", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("unsupported protocol");
    if (PRIVATE_HOST_RE.test(parsedUrl.hostname)) throw new Error("private host");
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const pageRes = await fetch(parsedUrl, { redirect: "follow" });
    const html = await pageRes.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);

    const prompt = `Here is the extracted text of a web page at ${url}:\n\n"""${text}"""\n\nRespond with ONLY minified JSON in the form {"title":"...","summary":"..."} — a concise page title and a one-sentence summary of what it's about. No markdown, no commentary.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const parsed = extractJson(response.text);
    res.json(parsed);
  } catch (err) {
    console.error("summarize-link error:", err.message);
    res.status(502).json({ error: "Couldn't fetch or summarize that link" });
  }
});

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

    const prompt = `You're ClipKick AI analyzing raw sports footage to build an AI Highlight Reel. Watch the video and respond with ONLY minified JSON in the form {"title":"...","duration":"m:ss","moments":[{"time":"m:ss","label":"..."}],"credits":["...","..."],"improve":["...","..."]}:
- title: a short catchy highlight-reel title for this footage (max 8 words)
- duration: your best estimate of the clip's total length, formatted m:ss
- moments: 3-6 of the most notable moments, each with an approximate timestamp (m:ss) and a short label (max 8 words)
- credits: 2-4 short, specific things the player did well
- improve: 1-3 short, specific things to work on
No markdown, no commentary.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: createUserContent([
        createPartFromUri(file.uri, file.mimeType),
        prompt,
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
