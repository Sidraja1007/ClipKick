import { type NextRequest, NextResponse } from "next/server"
import { ai, GEMINI_MODEL, extractJson } from "@/lib/gemini"

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 })
  }

  const { focus } = (await req.json()) as { focus?: string }
  if (!focus || typeof focus !== "string") {
    return NextResponse.json({ error: "focus is required" }, { status: 400 })
  }

  try {
    const prompt = `You are a professional youth soccer coach. A player wants to improve on: "${focus}". Respond with ONLY minified JSON in the form {"drills":["...","..."]} — 3-5 specific, actionable training drills or tips for this, each one short (max 20 words). No markdown, no commentary.`

    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt })
    const parsed = extractJson(response.text)
    return NextResponse.json(parsed)
  } catch (err) {
    console.error("[v0] training-tips error:", (err as Error).message)
    return NextResponse.json({ error: "Gemini couldn't generate tips" }, { status: 502 })
  }
}
