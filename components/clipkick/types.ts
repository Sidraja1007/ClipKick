export type ViewId = "reel" | "myreels" | "chat" | "tips" | "checkin" | "profile" | "schedule"

export type Moment = { time: string; label: string }

export type Reel = {
  id: number
  title: string
  duration: string
  moments: Moment[]
  credits: string[]
  improve: string[]
  createdAt: string
}

export type ChatMessage = { from: "me" | "them"; text: string }

export type Profile = { name: string; position: string; team: string }

export type Match = {
  opponent: string
  date: string
  weekday: string
  time: string
  location: string
  rsvped: boolean
}

export const VIEW_TITLES: Record<ViewId, string> = {
  reel: "Highlight Reel",
  myreels: "My Reels",
  chat: "Coach Chat",
  tips: "Training Tips",
  checkin: "Monthly Check-In",
  profile: "Player Profile",
  schedule: "Match Schedule",
}

export const REEL_STAGES = [
  "Uploading footage",
  "Analyzing footage",
  "Identifying best moments",
  "Assembling your highlight reel",
]

export function formatFileSize(bytes: number): string {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + " GB"
  if (bytes > 1e6) return (bytes / 1e6).toFixed(0) + " MB"
  return (bytes / 1e3).toFixed(0) + " KB"
}
