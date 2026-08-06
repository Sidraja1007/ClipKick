"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  type ChatMessage,
  type Match,
  type Profile,
  type Reel,
  type ViewId,
  VIEW_TITLES,
  REEL_STAGES,
  formatFileSize,
} from "./types"
import { ReelDetail } from "./reel-detail"
import {
  ChatIcon,
  CheckinIcon,
  MenuIcon,
  MyReelsIcon,
  ProfileIcon,
  ReelIcon,
  ScheduleIcon,
  TipsIcon,
  UploadIcon,
} from "./icons"

const INITIAL_MATCHES: Match[] = [
  { opponent: "Lakeside United", date: "Aug 2", weekday: "SUN", time: "10:00 AM", location: "Riverside Park Field 3", rsvped: false },
  { opponent: "Central Valley SC", date: "Aug 9", weekday: "SUN", time: "2:00 PM", location: "Away — Central Valley Complex", rsvped: false },
  { opponent: "Harbor City FC", date: "Aug 16", weekday: "SUN", time: "11:30 AM", location: "Riverside Park Field 1", rsvped: false },
]

const INITIAL_CHAT: ChatMessage[] = [
  {
    from: "them",
    text: "Hey! I'm your ClipKick Coach 👋 Ask me anything about training, tactics, recovery, or how to make the most of your highlight reels.",
  },
]

type ReelFlowState = "idle" | "ready" | "processing" | "result"

export function ClipKickApp() {
  const [view, setView] = useState<ViewId>("reel")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState("")
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [reelHistory, setReelHistory] = useState<Reel[]>([])
  const [profile, setProfile] = useState<Profile>({ name: "", position: "Forward", team: "" })
  const [matches, setMatches] = useState<Match[]>(INITIAL_MATCHES)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(""), 2800)
  }, [])

  const navigate = (v: ViewId) => {
    setView(v)
    setSidebarOpen(false)
  }

  const addReel = (reel: Reel) => setReelHistory((prev) => [reel, ...prev])

  const shareReel = (id: number) => {
    const r = reelHistory.find((x) => x.id === id)
    if (!r) return
    const lines = [
      `${r.title} (${r.duration})`,
      "",
      "Key moments:",
      ...r.moments.map((m) => `  ${m.time} — ${m.label}`),
      "",
      "What I did well:",
      ...r.credits.map((c) => `  • ${c}`),
      "",
      "Working on:",
      ...r.improve.map((c) => `  • ${c}`),
    ]
    const text = lines.join("\n")
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast("Copied — ready to paste into an email or message to your coach"),
        () => showToast("Couldn't copy automatically — select and copy the summary manually"),
      )
    } else {
      showToast("Clipboard access isn't available in this browser")
    }
  }

  const navItems: { section: string; items: { id: ViewId; label: string; icon: React.ReactNode }[] }[] = [
    {
      section: "Reels",
      items: [
        { id: "reel", label: "Highlight Reel", icon: <ReelIcon /> },
        { id: "myreels", label: "My Reels", icon: <MyReelsIcon /> },
      ],
    },
    {
      section: "Coaching",
      items: [
        { id: "chat", label: "Coach Chat", icon: <ChatIcon /> },
        { id: "tips", label: "Training Tips", icon: <TipsIcon /> },
        { id: "checkin", label: "Check-In", icon: <CheckinIcon /> },
      ],
    },
    {
      section: "Player",
      items: [
        { id: "profile", label: "Profile", icon: <ProfileIcon /> },
        { id: "schedule", label: "Schedule", icon: <ScheduleIcon /> },
      ],
    },
  ]

  return (
    <div className="ck-app">
      <div className={`overlay${sidebarOpen ? " show" : ""}`} onClick={() => setSidebarOpen(false)} />

      <div className="app">
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="logo">
            <div className="logo-mark">CK</div>
            <div>
              <div className="logo-text">CLIPKICK</div>
              <div className="logo-sub">AI Highlight Reels</div>
            </div>
          </div>

          <nav>
            {navItems.map((group) => (
              <div key={group.section}>
                <div className="nav-section">{group.section}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={`nav-item${view === item.id ? " active" : ""}`}
                    onClick={() => navigate(item.id)}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="plan-badge">
              <div className="dot" />
              <div>
                <strong>{profile.name || "Player"}</strong>
                <span>{profile.name ? `${profile.position} · ${profile.team || "No team set"}` : "Add your profile →"}</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="menu-toggle" aria-label="Menu" onClick={() => setSidebarOpen((o) => !o)}>
              <MenuIcon />
            </button>
            <h2>{VIEW_TITLES[view]}</h2>
            <div />
          </header>

          <div className="content">
            {view === "reel" && <HighlightReelView addReel={addReel} shareReel={shareReel} showToast={showToast} />}
            {view === "myreels" && <MyReelsView reels={reelHistory} shareReel={shareReel} />}
            {view === "chat" && <CoachChatView showToast={showToast} />}
            {view === "tips" && <TrainingTipsView reels={reelHistory} showToast={showToast} />}
            {view === "checkin" && <CheckinView reels={reelHistory} showToast={showToast} />}
            {view === "profile" && <ProfileView profile={profile} setProfile={setProfile} reels={reelHistory} />}
            {view === "schedule" && <ScheduleView matches={matches} setMatches={setMatches} showToast={showToast} />}
          </div>
        </div>
      </div>

      <div className={`toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  )
}

/* ---------------- Highlight Reel ---------------- */
function HighlightReelView({
  addReel,
  shareReel,
  showToast,
}: {
  addReel: (r: Reel) => void
  shareReel: (id: number) => void
  showToast: (m: string) => void
}) {
  const [state, setState] = useState<ReelFlowState>("idle")
  const [file, setFile] = useState<File | null>(null)
  const [currentStage, setCurrentStage] = useState(0)
  const [generated, setGenerated] = useState<Reel | null>(null)
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (stageTimer.current) clearTimeout(stageTimer.current) }, [])

  const handleFile = (f: File) => {
    setFile(f)
    setState("ready")
  }

  const startProcessing = async () => {
    if (!file) return
    setState("processing")
    setCurrentStage(0)
    if (stageTimer.current) clearTimeout(stageTimer.current)

    const tick = () => {
      setCurrentStage((prev) => {
        const next = prev < REEL_STAGES.length - 1 ? prev + 1 : prev
        if (next < REEL_STAGES.length - 1) stageTimer.current = setTimeout(tick, 1400)
        return next
      })
    }
    stageTimer.current = setTimeout(tick, 1400)

    const form = new FormData()
    form.append("video", file)

    try {
      const res = await fetch("/api/highlight-reel", { method: "POST", body: form })
      if (!res.ok) throw new Error(`highlight-reel ${res.status}`)
      const data = await res.json()
      const reel: Reel = {
        id: Date.now(),
        title: data.title || "Highlight Reel",
        duration: data.duration || "--:--",
        moments: Array.isArray(data.moments) ? data.moments : [],
        credits: Array.isArray(data.credits) ? data.credits : [],
        improve: Array.isArray(data.improve) ? data.improve : [],
        createdAt: new Date().toLocaleString(),
      }
      addReel(reel)
      if (stageTimer.current) clearTimeout(stageTimer.current)
      setGenerated(reel)
      setState("result")
    } catch {
      if (stageTimer.current) clearTimeout(stageTimer.current)
      showToast("Gemini couldn't process this video — try again")
      setState("ready")
    }
  }

  const reset = () => {
    setState("idle")
    setFile(null)
    setGenerated(null)
    if (stageTimer.current) clearTimeout(stageTimer.current)
  }

  return (
    <section className="view">
      {state === "idle" && (
        <div className="hero">
          <h1>
            Turn your game footage into a <em>highlight reel</em> that gets you noticed.
          </h1>
          <p>
            Upload a full match or training video. ClipKick&apos;s AI finds your best goals, assists, dribbles,
            tackles, and saves — then builds a timestamped highlight clip list, plus feedback on what you did well and
            what to work on.
          </p>
        </div>
      )}

      {state === "idle" && (
        <div
          className={`upload-zone${dragover ? " dragover" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDragover(true) }}
          onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragover(false) }}
          onDrop={(e) => {
            e.preventDefault()
            setDragover(false)
            if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0])
          }}
        >
          <UploadIcon />
          <h3>Drop your game video here or click to upload</h3>
          <p>Full match or training footage — ClipKick&apos;s AI finds your best moments</p>
          <button className="btn btn-primary" type="button">
            Choose video
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
          />
        </div>
      )}

      {state === "ready" && file && (
        <div className="upload-item">
          <div className="upload-item-icon">🎬</div>
          <div className="upload-item-info">
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)}</span>
          </div>
          <button className="btn btn-primary" onClick={startProcessing}>
            Generate Highlight Reel
          </button>
        </div>
      )}

      {state === "processing" && file && (
        <div className="reel-flow-card">
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>Processing {file.name}</div>
          <div className="stage-list">
            {REEL_STAGES.map((label, i) => {
              const cls = i < currentStage ? "done" : i === currentStage ? "active" : ""
              return (
                <div className={`stage-item ${cls}`} key={label}>
                  <div className="stage-dot">{i < currentStage ? "✓" : ""}</div>
                  {label}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {state === "result" && generated && (
        <div className="reel-flow-card">
          <ReelDetail reel={generated} onShare={shareReel} />
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={reset}>
              Analyze another video
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------------- My Reels ---------------- */
function MyReelsView({ reels, shareReel }: { reels: Reel[]; shareReel: (id: number) => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = reels.find((r) => r.id === selectedId)

  return (
    <section className="view">
      <div className="section-header">
        <h2>My Reels</h2>
      </div>

      {selected ? (
        <>
          <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={() => setSelectedId(null)}>
            ← Back to My Reels
          </button>
          <div className="reel-flow-card">
            <ReelDetail reel={selected} onShare={shareReel} />
          </div>
        </>
      ) : reels.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>🎬</div>
          <p>No reels yet — generate one from Highlight Reel and it&apos;ll show up here.</p>
        </div>
      ) : (
        <div className="reels-grid">
          {reels.map((r) => (
            <div className="reel-card" key={r.id} onClick={() => setSelectedId(r.id)}>
              <div className="reel-card-thumb" />
              <div className="reel-card-info">
                <h3>{r.title}</h3>
                <p>
                  {r.duration} · {r.moments.length} moments · {r.createdAt}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ---------------- Coach Chat ---------------- */
function CoachChatView({ showToast }: { showToast: (m: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_CHAT)
  const [input, setInput] = useState("")
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text) return
    const history = messages.slice(-8).filter((m) => m.text !== "…")
    setMessages((prev) => [...prev, { from: "me", text }, { from: "them", text: "…" }])
    setInput("")

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      })
      if (!res.ok) throw new Error(`chat ${res.status}`)
      const data = await res.json()
      if (!data.reply) throw new Error("No response from Coach")
      setMessages((prev) => replaceLastPending(prev, data.reply))
    } catch {
      setMessages((prev) => replaceLastPending(prev, "Couldn't reach your Coach just now — try again in a bit."))
      showToast("Gemini request failed")
    }
  }

  return (
    <section className="view">
      <div className="chat-panel">
        <div className="chat-messages" ref={messagesRef}>
          {messages.map((m, i) => (
            <div className={`message ${m.from}`} key={i}>
              {m.text}
            </div>
          ))}
        </div>
        <div className="chat-input">
          <input
            type="text"
            placeholder="Ask your coach anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) send()
            }}
          />
          <button className="btn btn-primary" onClick={send}>
            Send
          </button>
        </div>
      </div>
    </section>
  )
}

function replaceLastPending(messages: ChatMessage[], reply: string): ChatMessage[] {
  const copy = [...messages]
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].from === "them" && copy[i].text === "…") {
      copy[i] = { from: "them", text: reply }
      break
    }
  }
  return copy
}

/* ---------------- Training Tips ---------------- */
function TrainingTipsView({ reels, showToast }: { reels: Reel[]; showToast: (m: string) => void }) {
  const [focus, setFocus] = useState("")
  const [drills, setDrills] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  const requestTips = async (focusText: string) => {
    setLoading(true)
    setDrills(null)
    try {
      const res = await fetch("/api/training-tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: focusText }),
      })
      if (!res.ok) throw new Error(`training-tips ${res.status}`)
      const data = await res.json()
      setDrills(Array.isArray(data.drills) ? data.drills : [])
    } catch {
      setDrills(null)
      showToast("Gemini couldn't generate tips right now")
    } finally {
      setLoading(false)
    }
  }

  const getTips = () => {
    const f = focus.trim()
    if (!f) {
      showToast("Type something to work on first")
      return
    }
    requestTips(f)
  }

  const getFromLatest = () => {
    if (!reels.length) {
      showToast("Generate a highlight reel first")
      return
    }
    const f = reels[0].improve.join(", ") || "general soccer fundamentals"
    requestTips(f)
  }

  return (
    <section className="view">
      <div className="section-header">
        <h2>Training Tips</h2>
      </div>
      <div className="card">
        <div className="field">
          <label>What do you want to work on?</label>
          <input
            type="text"
            placeholder="e.g. finishing, first touch, stamina"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) getTips()
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={getTips}>
            Get Tips
          </button>
          <button className="btn btn-ghost" onClick={getFromLatest}>
            Use my latest reel&apos;s feedback
          </button>
        </div>

        {loading && <div className="disclaimer" style={{ marginTop: 16 }}>Getting drills…</div>}
        {!loading && drills && (
          <div className="drill-list">
            {drills.length ? (
              drills.map((d, i) => (
                <div className="drill-item" key={i}>
                  <span className="num">{i + 1}.</span>
                  <span>{d}</span>
                </div>
              ))
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No drills came back — try a different focus.</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/* ---------------- Monthly Check-In ---------------- */
function CheckinView({ reels, showToast }: { reels: Reel[]; showToast: (m: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ message: string; goals: string[] } | null>(null)

  const getCheckin = async () => {
    setLoading(true)
    setResult(null)
    const credits = reels.flatMap((r) => r.credits)
    const improve = reels.flatMap((r) => r.improve)
    try {
      const res = await fetch("/api/monthly-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reelCount: reels.length, credits, improve }),
      })
      if (!res.ok) throw new Error(`monthly-checkin ${res.status}`)
      const data = await res.json()
      setResult({ message: data.message || "", goals: Array.isArray(data.goals) ? data.goals : [] })
    } catch {
      setResult(null)
      showToast("Gemini couldn't generate a check-in right now")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="view">
      <div className="section-header">
        <h2>Monthly Check-In</h2>
      </div>
      <div className="card">
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>
          Get a reflection on your progress this session, based on the reels you&apos;ve generated.
        </p>
        <button className="btn btn-primary" onClick={getCheckin}>
          Get my check-in
        </button>

        {loading && <div className="disclaimer" style={{ marginTop: 16 }}>Putting together your check-in…</div>}
        {!loading && result && (
          <div className="card" style={{ marginTop: 16, padding: 18 }}>
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>{result.message}</p>
            {result.goals.length > 0 && (
              <div className="feedback-card improve" style={{ marginTop: 16 }}>
                <h4>Goals for next month</h4>
                <ul>
                  {result.goals.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/* ---------------- Profile ---------------- */
function ProfileView({
  profile,
  setProfile,
  reels,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  reels: Reel[]
}) {
  const totalReels = reels.length
  const totalMoments = reels.reduce((n, r) => n + r.moments.length, 0)
  const totalCredits = reels.reduce((n, r) => n + r.credits.length, 0)
  const totalImprove = reels.reduce((n, r) => n + r.improve.length, 0)

  return (
    <section className="view">
      <div className="section-header">
        <h2>Player Profile</h2>
      </div>
      <div className="card">
        <div className="field">
          <label>Name</label>
          <input
            type="text"
            placeholder="Your name"
            value={profile.name}
            onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Position</label>
          <select value={profile.position} onChange={(e) => setProfile((p) => ({ ...p, position: e.target.value }))}>
            <option>Forward</option>
            <option>Midfielder</option>
            <option>Defender</option>
            <option>Goalkeeper</option>
          </select>
        </div>
        <div className="field">
          <label>Team</label>
          <input
            type="text"
            placeholder="Your team"
            value={profile.team}
            onChange={(e) => setProfile((p) => ({ ...p, team: e.target.value }))}
          />
        </div>
        <div className="stats-grid">
          <div className="stat-tile">
            <strong>{totalReels}</strong>
            <span>Reels generated</span>
          </div>
          <div className="stat-tile">
            <strong>{totalMoments}</strong>
            <span>Moments captured</span>
          </div>
          <div className="stat-tile">
            <strong>{totalCredits}</strong>
            <span>Things done well</span>
          </div>
          <div className="stat-tile">
            <strong>{totalImprove}</strong>
            <span>Growth areas flagged</span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------------- Schedule ---------------- */
function ScheduleView({
  matches,
  setMatches,
  showToast,
}: {
  matches: Match[]
  setMatches: React.Dispatch<React.SetStateAction<Match[]>>
  showToast: (m: string) => void
}) {
  const toggleRsvp = (i: number) => {
    setMatches((prev) => {
      const copy = prev.map((m, idx) => (idx === i ? { ...m, rsvped: !m.rsvped } : m))
      showToast(copy[i].rsvped ? "You're marked as attending" : "RSVP removed")
      return copy
    })
  }

  return (
    <section className="view">
      <div className="section-header">
        <h2>Match Schedule</h2>
      </div>
      {matches.map((m, i) => (
        <div className="match-card" key={i}>
          <div className="match-date">
            <strong>{m.date.split(" ")[1]}</strong>
            <span>{m.date.split(" ")[0]}</span>
          </div>
          <div className="match-info">
            <h4>vs {m.opponent}</h4>
            <span>
              {m.time} · {m.location}
            </span>
          </div>
          <button className={`btn ${m.rsvped ? "btn-primary" : "btn-ghost"}`} onClick={() => toggleRsvp(i)}>
            {m.rsvped ? "Attending" : "RSVP"}
          </button>
        </div>
      ))}
    </section>
  )
}
