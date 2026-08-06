"use client"

import type { Reel } from "./types"

export function ReelDetail({ reel, onShare }: { reel: Reel; onShare: (id: number) => void }) {
  return (
    <>
      <div className="player">
        <div className="player-bg" />
        <div className="player-content">
          <div className="player-title">{reel.title}</div>
          <div className="player-meta">Highlight Reel · {reel.duration}</div>
        </div>
      </div>

      <div className="section-header">
        <h2>Key moments (timestamp list)</h2>
      </div>
      <div className="key-moments">
        {reel.moments.length ? (
          reel.moments.map((m, i) => (
            <div className="moment-pill" key={i}>
              <strong>{m.time}</strong> · {m.label}
            </div>
          ))
        ) : (
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>No standout moments detected.</span>
        )}
      </div>

      <div className="feedback-grid">
        <div className="feedback-card credit">
          <h4>What you did well</h4>
          <ul>{reel.credits.length ? reel.credits.map((c, i) => <li key={i}>{c}</li>) : <li>—</li>}</ul>
        </div>
        <div className="feedback-card improve">
          <h4>Keep working on</h4>
          <ul>{reel.improve.length ? reel.improve.map((c, i) => <li key={i}>{c}</li>) : <li>—</li>}</ul>
        </div>
      </div>

      <div className="disclaimer">
        This shows the AI&apos;s analysis and a timestamp list of your best moments. It doesn&apos;t export a trimmed
        video file — use the timestamps above to clip your own footage.
      </div>
      <div style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => onShare(reel.id)}>
          Copy summary to share with a coach
        </button>
      </div>
    </>
  )
}
