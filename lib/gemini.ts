import { GoogleGenAI } from "@google/genai"

if (!process.env.GEMINI_API_KEY) {
  // Surfaced at request time via the route handlers rather than crashing the whole app.
  console.error("[v0] Missing GEMINI_API_KEY — set it in the project environment variables.")
}

export const GEMINI_MODEL = "gemini-2.5-flash"

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" })

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function extractJson<T = unknown>(text: string | undefined): T {
  const cleaned = (text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim()
  return JSON.parse(cleaned) as T
}
