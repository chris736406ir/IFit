import { useState, useEffect } from 'react'
import { C, DAYS, DAYS_FULL, getWeekStart, todayStr, getPhaseWeek, PHASES } from '../lib/constants.js'
import { ATHLETE_PROFILE } from '../lib/constants.js'
import { getWeekPlan, saveWeekPlan, getLogsForWeek, getLog, saveLog, getRecentLogs } from '../lib/supabase.js'
import { callAIJSON } from '../lib/ai.js'

// ─── Week generation prompt ───────────────────────────────────────────────────

function buildWeekPrompt(profile, weekStart, recentLogs, prevWeekPlan) {
  const phaseWeek = getPhaseWeek(profile.phase_start)
  const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
  const prefs = profile.preferences || {}

  const system = `You are a personal AI fitness coach. Athlete profile:\n${ATHLETE_PROFILE}\nCurrent weight: ${profile.weight_lbs}lbs\nPhase: ${phase.label} (Week ${phaseWeek})\nPreferences: Swim ${prefs.swim_per_week || 2}x/week, Basketball ${prefs.basketball_per_week || 1}x/week, Kickboxing ${prefs.kickboxing_per_week || 3}x/week morning.\nRespond ONLY with valid JSON starting with { and ending with }.`

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }

  const prevWeights = extractWeights(recentLogs)

  const user = `Generate a complete 7-day training plan for the week starting ${weekStart} (${DAYS_FULL[new Date(weekStart + 'T12:00:00').getDay()]}).

Recent workout history (last 21 days):
${recentLogs.length > 0 ? JSON.stringify(recentLogs.map(l => ({ date: l.date, pm_exercises: l.pm_exercises, pm_feel: l.pm_feel, morning_type: l.morning_type, overall_feel: l.overall_feel, soreness: l.soreness }))) : 'No history — first week.'}

Previous week's working weights (for progressive overload):
${JSON.stringify(prevWeights)}

Days to plan: ${days.join(', ')}

Rules:
- Sunday = active recovery (light session only, no heavy lifting)
- Progressive overload: increase weight 2.5-5lbs or add 1 rep from logged history
- Distribute: swim ${prefs.swim_per_week || 2}x, basketball ${prefs.basketball_per_week || 1}x, kickboxing ${prefs.kickboxing_per_week || 3}x mornings
- Morning sessions: fasted, 20-45min, home gym, mobility/activation/kickboxing focus
- Afternoon sessions: commercial gym, 90min, main training
- Never train same muscle group two days in a row
- Include hip mobility EVERY morning without exception
- Core work minimum 3x this week

Return JSON:
{
  "week_start": "${weekStart}",
  "phase_note": "coaching note for this week",
  "days": {
    "${days[0]}": {
      "label": "Day label e.g. Monday - Push",
      "day_type": "training|active_recovery",
      "morning": {
        "label": "session name",
        "duration_min": 30,
        "type": "mobility|kickboxing|swim|run|stretch",
        "focus": "brief focus",
        "exercises": [{"name":"","sets":0,"reps":"","notes":""}],
        "notes": ""
      },
      "afternoon": {
        "label": "session name",
        "duration_min": 90,
        "type": "push|pull|legs|full_body|swim|basketball|rest",
        "focus": "brief focus",
        "muscle_groups": [],
        "warmup": [{"name":"","duration":""}],
        "exercises": [{"name":"","sets":0,"reps":"","weight_suggestion":"","notes":""}],
        "finisher": {"name":"","description":""},
        "notes": ""
      }
    }
    ${days.slice(1).map(d => `,"${d}": { same structure }`).join('\n')}
  }
}`

  return { system, user }
}

function buildAdjustmentPrompt(profile, weekPlan, logsThisWeek, adjustmentNote, remainingDays) {
  const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
  const system = `You are a personal AI fitness coach. Athlete profile:\n${ATHLETE_PROFILE}\nPhase: ${phase.label}\nRespond ONLY with valid JSON starting with { and ending with }.`

  const user = `The athlete has flagged an adjustment mid-week.

Adjustment note: "${adjustmentNote}"

Original week plan:
${JSON.stringify(weekPlan.days, null, 2)}

Logs so far this week:
${JSON.stringify(logsThisWeek)}

Remaining days to adjust: ${remainingDays.join(', ')}

Regenerate ONLY the remaining days based on the adjustment. If they swam today, reduce swim frequency for remaining days. If legs are sore, shift leg work later. If they missed a session, redistribute if possible.

Return JSON with ONLY the adjusted remaining days:
{
  "adjustment_applied": "brief description of what changed and why",
  "days": {
    ${remainingDays.map(d => `"${d}": { same day structure as original plan }`).join(',\n')}
  }
}`

  return { system, user }
}

function extractWeights(logs) {
  const weights = {}
  logs.forEach(log => {
    if (log.pm_exercises) {
      log.pm_exercises.forEach(ex => {
        if (ex.weight && ex.name) {
          if (!weights[ex.name] || new Date(log.date) > new Date(weights[ex.name].date)) {
            weights[ex.name] = { weight: ex.weight, reps: ex.reps, sets: ex.sets, date: log.date }
          }
        }
      })
    }
  })
  return weights
}

// ─── Components ───────────────────────────────────────────────────────────────

function ExerciseList({ exercises, color }) {
  if (!exercises?.length) return null
  return (
    <div>
      {exercises.map((ex, i) => (
        <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < exercises.length - 1 ? `1px solid ${C.surfaceAlt}` : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontWeight: 600, fontSize: 14, flex: 1, paddingRight: 8 }}>{ex.name}</div>
            <div style={{ fontSize: 12, color, fontWeight: 700, whiteSpace: 'nowrap' }}>{ex.sets} × {ex.reps}</div>
          </div>
          {ex.weight_suggestion && <div style={{ fontSize: 12, color: C.orange, marginTop: 3 }}>🏋 {ex.weight_suggestion}</div>}
          {ex.notes && <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{ex.notes}</div>}
        </div>
      ))}
    </div>
  )
}

function SessionCard({ session, colorBadge, label, icon, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || false)
  if (!session) return null
  return (
    <div className="card">
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span className="badge" style={{ background: colorBadge + '22', color: colorBadge, border: `1px solid ${colorBadge}44` }}>{icon} {label}</span>
            <span style={{ fontSize: 12, color: C.muted }}>{session.duration_min}min</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{session.label}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{session.focus}</div>
        </div>
        <span style={{ color: C.muted, fontSize: 20, marginTop: 2 }}>{open ? '↑' : '↓'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          {session.warmup?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="section-title">Warmup</div>
              {session.warmup.map((w, i) => <div key={i} style={{ fontSize: 13, color: '#aaa', marginBottom: 4 }}>• {w.name} — {w.duration}</div>)}
            </div>
          )}
          {session.exercises?.length > 0 && (
            <>
              {session.warmup?.length > 0 && <div className="section-title" style={{ marginBottom: 10 }}>Main Work</div>}
              <ExerciseList exercises={session.exercises} color={colorBadge} />
            </>
          )}
          {session.finisher?.name && (
            <div style={{ background: C.redSoft, border: `1px solid ${C.red}33`, borderRadius: 10, padding: '10px 12px', marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Finisher 🔥</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{session.finisher.name}</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 3 }}>{session.finisher.description}</div>
            </div>
          )}
          {session.notes && (
            <div style={{ fontSize: 12, color: '#9c8fff', background: C.accentSoft, borderRadius: 8, padding: '8px 12px', marginTop: 12 }}>💬 {session.notes}</div>
          )}
        </div>
      )}
    </div>
  )
}

function LogPanel({ date, log, dayPlan, onSave }) {
  const existing = log || {}
  const [sleep, setSleep] = useState(existing.sleep_hours?.toString() || '7')
  const [energyAm, setEnergyAm] = useState(existing.energy_am?.toString() || '7')
  const [morningDone, setMorningDone] = useState(existing.morning_done || false)
  const [morningType, setMorningType] = useState(existing.morning_type || '')
  const [morningFeel, setMorningFeel] = useState(existing.morning_feel?.toString() || '7')
  const [morningNotes, setMorningNotes] = useState(existing.morning_notes || '')
  const [exercises, setExercises] = useState(existing.pm_exercises || [])
  const [pmType, setPmType] = useState(existing.pm_type || '')
  const [pmFeel, setPmFeel] = useState(existing.pm_feel?.toString() || '7')
  const [pmNotes, setPmNotes] = useState(existing.pm_notes || '')
  const [soreness, setSoreness] = useState(existing.soreness || {})
  const [overall, setOverall] = useState(existing.overall_feel?.toString() || '7')
  const [adjustNote, setAdjustNote] = useState(existing.adjustment_note || '')
  const [saved, setSaved] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newEx, setNewEx] = useState({ name: '', sets: '3', reps: '10', weight: '' })

  const bodyParts = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Core', 'Glutes']

  function addEx() {
    if (!newEx.name.trim()) return
    setExercises([...exercises, { ...newEx }])
    setNewEx({ name: '', sets: '3', reps: '10', weight: '' })
    setAdding(false)
  }

  async function save() {
    const entry = {
      date, sleep_hours: parseFloat(sleep), energy_am: parseInt(energyAm),
      morning_done: morningDone, morning_type: morningType, morning_feel: parseInt(morningFeel),
      morning_notes: morningNotes, pm_exercises: exercises, pm_type: pmType,
      pm_feel: parseInt(pmFeel), pm_notes: pmNotes, overall_feel: parseInt(overall),
      soreness, adjustment_note: adjustNote,
    }
    await onSave(entry)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const Slider = ({ label, value, onChange, color = C.accent }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span className="label">{label}</span>
        <span style={{ fontSize: 13, color, fontWeight: 700 }}>{value}/10</span>
      </div>
      <input type="range" min="1" max="10" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', accentColor: color }} />
    </div>
  )

  return (
    <div>
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: '#9c8fff', marginBottom: 14 }}>😴 Sleep & Energy</div>
        <div style={{ marginBottom: 14 }}>
          <label className="label">Hours Slept</label>
          <input className="input" type="number" step="0.5" value={sleep} onChange={e => setSleep(e.target.value)} style={{ width: 100 }} />
        </div>
        <Slider label="Morning Energy" value={energyAm} onChange={setEnergyAm} color={C.orange} />
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: C.orange, marginBottom: 14 }}>🌅 Morning Session</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={morningDone} onChange={e => setMorningDone(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.green }} />
          <span style={{ fontSize: 14 }}>Completed morning session</span>
        </label>
        {morningDone && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label className="label">What did you do? (e.g. "swam 1km", "kickboxing rounds", "hip mobility")</label>
              <input className="input" value={morningType} onChange={e => setMorningType(e.target.value)} placeholder={dayPlan?.morning?.label || 'Describe session...'} />
            </div>
            <Slider label="How did it feel?" value={morningFeel} onChange={setMorningFeel} color={C.orange} />
            <label className="label">Notes</label>
            <input className="input" value={morningNotes} onChange={e => setMorningNotes(e.target.value)} placeholder="e.g. hips were tight, felt great..." />
          </>
        )}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: C.accent, marginBottom: 14 }}>🏋️ Afternoon Session</div>
        <div style={{ marginBottom: 14 }}>
          <label className="label">Session type (e.g. "push day", "swam laps", "basketball")</label>
          <input className="input" value={pmType} onChange={e => setPmType(e.target.value)} placeholder={dayPlan?.afternoon?.label || 'What did you do?'} />
        </div>

        {exercises.map((ex, i) => (
          <div key={i} className="card-alt" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{ex.name}</div>
              <div style={{ fontSize: 12, color: C.accent }}>{ex.sets}×{ex.reps}{ex.weight ? ` @ ${ex.weight}lbs` : ''}</div>
            </div>
            <button onClick={() => setExercises(exercises.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 20 }}>×</button>
          </div>
        ))}

        {adding ? (
          <div className="card-alt">
            <div style={{ marginBottom: 10 }}>
              <label className="label">Exercise</label>
              <input className="input" placeholder="e.g. DB Incline Press" value={newEx.name} onChange={e => setNewEx({ ...newEx, name: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[['Sets', 'sets'], ['Reps', 'reps'], ['lbs', 'weight']].map(([lbl, key]) => (
                <div key={key}>
                  <label className="label">{lbl}</label>
                  <input className="input" type="number" value={newEx[key]} onChange={e => setNewEx({ ...newEx, [key]: e.target.value })} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={addEx} style={{ margin: 0, flex: 1 }}>Add</button>
              <button className="btn-secondary" onClick={() => setAdding(false)} style={{ margin: 0, flex: 1 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setAdding(true)}>+ Add Exercise</button>
        )}

        <Slider label="How did PM feel?" value={pmFeel} onChange={setPmFeel} />
        <label className="label">Notes</label>
        <input className="input" value={pmNotes} onChange={e => setPmNotes(e.target.value)} placeholder="e.g. shoulder felt strong, swam 1km instead..." style={{ marginBottom: 0 }} />
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: C.red, marginBottom: 14 }}>💢 Soreness Check</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {bodyParts.map(part => (
            <button key={part} onClick={() => setSoreness(s => ({ ...s, [part]: s[part] ? undefined : 7 }))}
              style={{ background: soreness[part] ? C.redSoft : C.surfaceAlt, border: `1px solid ${soreness[part] ? C.red : C.subtle}`, borderRadius: 20, padding: '6px 14px', fontSize: 12, color: soreness[part] ? C.red : C.muted, cursor: 'pointer', fontWeight: soreness[part] ? 700 : 400 }}>
              {part}
            </button>
          ))}
        </div>
        {Object.keys(soreness).filter(k => soreness[k]).map(part => (
          <div key={part} style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: C.muted }}>{part} soreness</span>
              <span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>{soreness[part]}/10</span>
            </div>
            <input type="range" min="1" max="10" value={soreness[part]} onChange={e => setSoreness(s => ({ ...s, [part]: parseInt(e.target.value) }))} style={{ width: '100%', accentColor: C.red }} />
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: C.yellow, marginBottom: 10 }}>⚡ Adjustment Flag</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Did anything happen today that should affect the rest of this week? (injury, extra swim, crushed it, etc.)</div>
        <textarea className="input" value={adjustNote} onChange={e => setAdjustNote(e.target.value)}
          placeholder="e.g. swam 2km this morning, legs are destroyed — skip leg work for 2 days&#10;e.g. tweaked left ankle, avoid jumping&#10;e.g. felt amazing, ready to push harder"
          style={{ height: 80, resize: 'none' }} />
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: C.green, marginBottom: 14 }}>🌟 Overall Day</div>
        <Slider label="Overall Feel" value={overall} onChange={setOverall} color={C.green} />
      </div>

      <div style={{ padding: '0 16px' }}>
        <button className="btn-primary" onClick={save} style={{ background: saved ? C.green : C.accent }}>
          {saved ? '✓ Saved!' : 'Save Log'}
        </button>
      </div>
    </div>
  )
}

// ─── Main WeekScreen ──────────────────────────────────────────────────────────

export default function WeekScreen({ profile }) {
  const weekStart = getWeekStart()
  const today = todayStr()

  const [weekPlan, setWeekPlan] = useState(null)
  const [logs, setLogs] = useState({})
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedLog, setSelectedLog] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('plan') // plan | log

  // Build week dates
  const weekDates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    weekDates.push(d.toISOString().split('T')[0])
  }

  useEffect(() => {
    loadWeek()
  }, [])

  useEffect(() => {
    loadLog(selectedDate)
  }, [selectedDate])

  async function loadWeek() {
    const [plan, weekLogs] = await Promise.all([
      getWeekPlan(weekStart),
      getLogsForWeek(weekStart)
    ])
    setWeekPlan(plan)
    const logMap = {}
    weekLogs.forEach(l => { logMap[l.date] = l })
    setLogs(logMap)
  }

  async function loadLog(date) {
    const log = await getLog(date)
    setSelectedLog(log)
  }

  async function generateWeek() {
    setGenerating(true)
    setError(null)
    try {
      const recentLogs = await getRecentLogs(21)
      const { system, user } = buildWeekPrompt(profile, weekStart, recentLogs, weekPlan)
      const data = await callAIJSON(system, user, 5000)
      const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
      await saveWeekPlan(weekStart, data.days, phase.label, getPhaseWeek(profile.phase_start))
      setWeekPlan({ days: data.days, phase_note: data.phase_note })
    } catch (e) {
      setError(e.message)
    }
    setGenerating(false)
  }

  async function adjustWeek() {
    const todayLog = logs[today]
    if (!todayLog?.adjustment_note) return
    setAdjusting(true)
    setError(null)
    try {
      const remainingDays = weekDates.filter(d => d > today)
      if (remainingDays.length === 0) { setAdjusting(false); return }
      const logsThisWeek = Object.values(logs)
      const { system, user } = buildAdjustmentPrompt(profile, weekPlan, logsThisWeek, todayLog.adjustment_note, remainingDays)
      const data = await callAIJSON(system, user, 4000)
      const updatedDays = { ...weekPlan.days, ...data.days }
      await saveWeekPlan(weekStart, updatedDays, weekPlan.phase, weekPlan.phase_week)
      setWeekPlan(p => ({ ...p, days: updatedDays, adjustment_applied: data.adjustment_applied }))
    } catch (e) {
      setError(e.message)
    }
    setAdjusting(false)
  }

  async function handleSaveLog(entry) {
    await saveLog(entry)
    setLogs(l => ({ ...l, [entry.date]: entry }))
    setSelectedLog(entry)
    if (entry.adjustment_note && weekPlan) {
      await adjustWeek()
    }
  }

  const isSunday = new Date().getDay() === 0
  const selectedDay = weekPlan?.days?.[selectedDate]
  const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
  const phaseWeek = getPhaseWeek(profile.phase_start)

  function dayStatus(date) {
    const log = logs[date]
    if (log?.overall_feel) return 'logged'
    if (weekPlan?.days?.[date]) return 'planned'
    return 'empty'
  }

  return (
    <div className="screen">
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: -0.5 }}>⚡ IFit</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          </div>
          <span className="badge" style={{ background: phase.color + '22', color: phase.color, border: `1px solid ${phase.color}44` }}>
            {phase.label} · W{phaseWeek}
          </span>
        </div>

        {/* Week strip */}
        <div style={{ display: 'flex', gap: 4 }}>
          {weekDates.map((date, i) => {
            const status = dayStatus(date)
            const isToday = date === today
            const isSelected = date === selectedDate
            return (
              <button key={date} onClick={() => setSelectedDate(date)} style={{
                flex: 1, background: isSelected ? C.accent : 'transparent',
                border: `1px solid ${isToday ? C.accent : isSelected ? C.accent : C.border}`,
                borderRadius: 10, padding: '6px 0', cursor: 'pointer', transition: 'all 0.15s'
              }}>
                <div style={{ fontSize: 10, color: isSelected ? '#fff' : C.muted, marginBottom: 3 }}>{DAYS[i]}</div>
                <div style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isSelected ? '#fff' : isToday ? C.accent : C.text }}>
                  {new Date(date + 'T12:00:00').getDate()}
                </div>
                <div style={{ marginTop: 3 }}>
                  {status === 'logged' && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, margin: '0 auto' }} />}
                  {status === 'planned' && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.muted, margin: '0 auto' }} />}
                  {status === 'empty' && <div style={{ width: 5, height: 5, margin: '0 auto' }} />}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ paddingTop: 16 }}>
        {/* Sunday prompt */}
        {isSunday && !weekPlan && !generating && (
          <div className="card" style={{ textAlign: 'center', padding: '24px 18px', background: C.accentSoft, border: `1px solid ${C.accent}44` }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>It's Sunday — Generate This Week</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>AI will plan your full week with progressive overload, swim days, kickboxing, and meals.</div>
            <button className="btn-primary" onClick={generateWeek} style={{ width: 'auto', padding: '12px 28px', marginBottom: 0 }}>Generate Week ⚡</button>
          </div>
        )}

        {!weekPlan && !isSunday && !generating && (
          <div className="card" style={{ textAlign: 'center', padding: '24px 18px' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🤖</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No Plan for This Week</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>Generate your week now or wait until Sunday for the auto-prompt.</div>
            <button className="btn-primary" onClick={generateWeek} style={{ width: 'auto', padding: '12px 28px', marginBottom: 0 }}>Generate Now</button>
          </div>
        )}

        {generating && (
          <div className="card" style={{ textAlign: 'center', padding: '24px 18px' }}>
            <div style={{ fontSize: 24, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 13, color: C.muted }}>Building your 7-day plan with progressive overload...</div>
          </div>
        )}

        {adjusting && (
          <div className="card" style={{ background: C.yellowSoft, border: `1px solid ${C.yellow}44`, textAlign: 'center', padding: '12px 18px' }}>
            <div style={{ fontSize: 12, color: C.yellow }}>⚡ Adjusting remaining week based on your note...</div>
          </div>
        )}

        {error && (
          <div className="card" style={{ background: C.redSoft, border: `1px solid ${C.red}44` }}>
            <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠️ {error}</div>
            <button className="btn-primary" onClick={generateWeek} style={{ marginBottom: 0 }}>Retry</button>
          </div>
        )}

        {weekPlan?.adjustment_applied && (
          <div className="card" style={{ background: C.yellowSoft, border: `1px solid ${C.yellow}44` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.yellow, marginBottom: 4 }}>WEEK ADJUSTED</div>
            <div style={{ fontSize: 12, color: '#aaa' }}>{weekPlan.adjustment_applied}</div>
          </div>
        )}

        {weekPlan?.phase_note && (
          <div className="card" style={{ background: C.accentSoft, border: `1px solid ${C.accent}44` }}>
            <div style={{ fontSize: 12, color: '#9c8fff' }}>📍 {weekPlan.phase_note}</div>
          </div>
        )}

        {/* Selected day */}
        {weekPlan && (
          <>
            {/* Day header */}
            <div style={{ padding: '0 16px 4px' }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {selectedDate === today && <span style={{ fontSize: 12, color: C.accent, marginLeft: 8 }}>· Today</span>}
              </div>
              {selectedDay?.label && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{selectedDay.label}</div>}
            </div>

            {/* Plan / Log tabs */}
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px 4px' }}>
              {['plan', 'log'].map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: 1, background: tab === t ? C.accent : C.surfaceAlt, color: tab === t ? '#fff' : C.muted,
                  border: 'none', borderRadius: 10, padding: '8px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer'
                }}>
                  {t === 'plan' ? '📋 Plan' : '✏️ Log'}
                </button>
              ))}
            </div>

            {tab === 'plan' && (
              <>
                {logs[selectedDate]?.overall_feel && (
                  <div className="card" style={{ background: C.greenSoft, border: `1px solid ${C.green}44` }}>
                    <div style={{ fontSize: 12, color: C.green }}>✓ Logged · Overall feel: {logs[selectedDate].overall_feel}/10 · {logs[selectedDate].pm_type || 'Session complete'}</div>
                  </div>
                )}
                {selectedDay ? (
                  <>
                    <SessionCard session={selectedDay.morning} colorBadge={C.orange} label="Morning" icon="🌅" />
                    <SessionCard session={selectedDay.afternoon} colorBadge={C.accent} label="Afternoon" icon="🏋️" defaultOpen={selectedDate === today} />
                  </>
                ) : (
                  <div className="card" style={{ textAlign: 'center', color: C.muted, padding: '24px 18px' }}>
                    No plan for this day yet.
                  </div>
                )}
                {weekPlan && (
                  <div style={{ padding: '4px 16px' }}>
                    <button className="btn-secondary" onClick={generateWeek} disabled={generating} style={{ fontSize: 13 }}>↺ Regenerate Full Week</button>
                  </div>
                )}
              </>
            )}

            {tab === 'log' && (
              <LogPanel date={selectedDate} log={logs[selectedDate] || selectedLog} dayPlan={selectedDay} onSave={handleSaveLog} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
