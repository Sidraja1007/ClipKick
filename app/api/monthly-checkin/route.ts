import { type NextRequest, NextResponse } from "next/server"
import { ai, GEMINI_MODEL, extractJson } from "@/lib/gemini"

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 })
  }

  const { reelCount, credits, improve } = (await req.json()) as {
    reelCount?: number
    credits?: string[]
    improve?: string[]
  }

  try {
    const creditsText = (Array.isArray(credits) ? credits : []).join("; ") || "no reels analyzed yet"
    const improveText = (Array.isArray(improve) ? improve : []).join("; ") || "no reels analyzed yet"
    const prompt = `You are an encouraging youth soccer coach doing a monthly check-in with a player. This session they've generated ${reelCount || 0} highlight reel(s). Things they've done well across those reels: ${creditsText}. Areas they're working on: ${improveText}. Respond with ONLY minified JSON in the form {"message":"...","goals":["...","..."]} — a warm, specific 3-5 sentence check-in message reflecting on their progress, plus 2-3 concrete goals for next month. No markdown, no commentary.`

    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt })
    const parsed = extractJson(response.text)
    return NextResponse.json(parsed)
  } catch (err) {
    console.error("[v0] monthly-checkin error:", (err as Error).message)
    return NextResponse.json({ error: "Gemini couldn't generate a check-in" }, { status: 502 })
  }
}
