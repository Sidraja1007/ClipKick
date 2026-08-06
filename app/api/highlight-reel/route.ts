import { type NextRequest, NextResponse } from "next/server"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { createUserContent, createPartFromUri } from "@google/genai"
import { ai, GEMINI_MODEL, extractJson, sleep } from "@/lib/gemini"

// Match footage is typically far bigger than the ~20MB inline-data limit, so this
// route writes the upload to a temp file and hands Gemini's Files API a path.
export const maxDuration = 300

const HIGHLIGHT_REEL_PROMPT = `You are an expert soccer video analyst and highlight editor. The user has provided a full soccer match or training video of themselves playing. Analyze the video to identify the player's best moments, including goals, assists, successful dribbles, tackles, saves, key passes, and other standout plays.

Respond with ONLY minified JSON in the form {"title":"...","duration":"m:ss","moments":[{"time":"m:ss","label":"..."}],"credits":["...","..."],"improve":["...","..."]}:
- title: a short catchy highlight-reel title for this footage (max 8 words)
- duration: your best estimate of the clip's total length, formatted m:ss
- moments: the best moments selected for the reel in chronological order, each with an approximate timestamp (m:ss) and a short label (max 8 words) — this is the timestamp list of clips selected for the highlight reel
- credits: 2-4 short, specific things the player did well
- improve: 1-3 short, specific things the player can work on for next time
No markdown, no commentary.`

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 })
  }

  const form = await req.formData()
  const video = form.get("video")
  if (!video || typeof video === "string") {
    return NextResponse.json({ error: "video is required" }, { status: 400 })
  }

  const mimeType = video.type || "video/mp4"
  const bytes = Buffer.from(await video.arrayBuffer())
  const tempPath = path.join(os.tmpdir(), `clipkick-${randomUUID()}`)

  try {
    await fs.promises.writeFile(tempPath, bytes)

    let file = await ai.files.upload({ file: tempPath, config: { mimeType } })

    while (file.state === "PROCESSING") {
      await sleep(3000)
      file = await ai.files.get({ name: file.name as string })
    }
    if (file.state !== "ACTIVE") {
      throw new Error(`Gemini file processing ended in state ${file.state}`)
    }

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: createUserContent([
        createPartFromUri(file.uri as string, file.mimeType as string),
        HIGHLIGHT_REEL_PROMPT,
      ]),
    })

    const parsed = extractJson(response.text)
    return NextResponse.json(parsed)
  } catch (err) {
    console.error("[v0] highlight-reel error:", (err as Error).message)
    return NextResponse.json({ error: "Gemini couldn't analyze this video" }, { status: 502 })
  } finally {
    fs.promises.unlink(tempPath).catch(() => {})
  }
}
