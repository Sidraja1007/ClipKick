import { type NextRequest, NextResponse } from "next/server"
import { ai, GEMINI_MODEL } from "@/lib/gemini"

const COACH_SYSTEM_PROMPT = `You are ClipKick Coach, an AI assistant for a youth soccer highlight-reel app. You talk to talented young soccer players who want to improve and get noticed by coaches/scouts. Be warm, encouraging, and specific — give real soccer knowledge (training, tactics, recovery, mindset), not generic filler. Keep answers to 2-4 sentences.`

type Turn = { from?: string; text?: string }

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 })
  }

  const { message, history } = (await req.json()) as { message?: string; history?: Turn[] }
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 })
  }

  try {
    const turns = (Array.isArray(history) ? history : [])
      .filter((m) => m && typeof m.text === "string")
      .map((m) => `${m.from === "me" ? "Player" : "Coach"}: ${m.text}`)
      .join("\n")
    const prompt = `${COACH_SYSTEM_PROMPT}\n\n${turns ? turns + "\n" : ""}Player: ${message}\nCoach:`

    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt })
    const reply = response.text?.trim()
    if (!reply) throw new Error("Empty response from Gemini")
    return NextResponse.json({ reply })
  } catch (err) {
    console.error("[v0] chat error:", (err as Error).message)
    return NextResponse.json({ error: "Gemini request failed" }, { status: 502 })
  }
}
