import { useState, useEffect } from 'react'
import { C, formatDate } from '../lib/constants.js'
import { getRecentLogs } from '../lib/supabase.js'

export default function ProgressScreen({ profile }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecentLogs(30).then(data => { setLogs(data); setLoading(false) })
  }, [])

  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  const feelColor = f => f >= 8 ? C.green : f >= 6 ? C.orange : C.red

  // Extract unique exercises and best weights
  const lifts = {}
  logs.forEach(log => {
    if (log.pm_exercises) {
      log.pm_exercises.forEach(ex => {
        if (ex.weight && ex.name) {
          if (!lifts[ex.name] || parseFloat(ex.weight) > parseFloat(lifts[ex.name].weight)) {
            lifts[ex.name] = { weight: ex.weight, reps: ex.reps, date: log.date }
          }
        }
      })
    }
  })

  const avgFeel = logs.length > 0 ? (logs.reduce((s, l) => s + (l.overall_feel || 0), 0) / logs.length).toFixed(1) : '—'
  const totalSessions = logs.filter(l => l.pm_exercises?.length > 0 || l.morning_done).length
  const avgSleep = logs.length > 0 ? (logs.reduce((s, l) => s + (l.sleep_hours || 0), 0) / logs.length).toFixed(1) : '—'

  // Mini bar chart for feel ratings
  const recentFeel = sorted.slice(-14)

  return (
    <div className="screen">
      <div className="header">
        <div style={{ fontWeight: 800, fontSize: 17 }}>📊 Progress</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Last 30 days</div>
      </div>

      <div style={{ paddingTop: 16 }}>
        {loading ? (
          <div className="card" style={{ textAlign: 'center', color: C.muted }}>Loading...</div>
        ) : (
          <>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: '0 16px 12px' }}>
              {[
                { label: 'Avg Feel', value: avgFeel, color: C.green, unit: '/10' },
                { label: 'Sessions', value: totalSessions, color: C.accent, unit: '' },
                { label: 'Avg Sleep', value: avgSleep, color: C.orange, unit: 'h' },
              ].map(s => (
                <div key={s.label} style={{ background: C.surface, borderRadius: 14, padding: '14px 12px', border: `1px solid ${C.border}`, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}<span style={{ fontSize: 13 }}>{s.unit}</span></div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Feel chart */}
            {recentFeel.length > 0 && (
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Daily Feel Rating (14 days)</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60 }}>
                  {recentFeel.map((log, i) => {
                    const feel = log.overall_feel || 0
                    const height = feel ? `${(feel / 10) * 100}%` : '4px'
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                        <div style={{ width: '100%', background: feelColor(feel), borderRadius: 4, height, minHeight: 4, transition: 'height 0.3s' }} />
                        <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>{new Date(log.date + 'T12:00:00').getDate()}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Top lifts */}
            {Object.keys(lifts).length > 0 && (
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>🏋️ Best Logged Weights</div>
                {Object.entries(lifts).slice(0, 10).map(([name, data]) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid ${C.surfaceAlt}` }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{formatDate(data.date)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: C.accent }}>{data.weight}lbs</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{data.reps} reps</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent log history */}
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📅 Session History</div>
              {sorted.length === 0 ? (
                <div style={{ textAlign: 'center', color: C.muted, padding: '16px 0' }}>No sessions logged yet.</div>
              ) : [...sorted].reverse().map((log, i) => (
                <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${C.surfaceAlt}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{formatDate(log.date)}</div>
                    {log.overall_feel && (
                      <span className="badge" style={{ background: feelColor(log.overall_feel) + '22', color: feelColor(log.overall_feel), border: `1px solid ${feelColor(log.overall_feel)}44`, fontSize: 10 }}>
                        Feel {log.overall_feel}/10
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {log.sleep_hours && <span style={{ fontSize: 11, color: C.muted }}>😴 {log.sleep_hours}h</span>}
                    {log.morning_done && log.morning_type && <span style={{ fontSize: 11, color: C.orange }}>🌅 {log.morning_type}</span>}
                    {log.pm_type && <span style={{ fontSize: 11, color: C.accent }}>🏋️ {log.pm_type}</span>}
                    {log.pm_exercises?.length > 0 && <span style={{ fontSize: 11, color: C.muted }}>{log.pm_exercises.length} exercises</span>}
                  </div>
                  {log.pm_notes && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, fontStyle: 'italic' }}>"{log.pm_notes}"</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
