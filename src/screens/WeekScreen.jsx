import { useState, useEffect } from 'react'
import { C, DAYS, DAYS_FULL, getWeekStart, todayStr, getPhaseWeek, PHASES } from '../lib/constants.js'
import { ATHLETE_PROFILE } from '../lib/constants.js'
import { getWeekPlan, saveWeekPlan, getLogsForWeek, getLog, saveLog, getRecentLogs } from '../lib/supabase.js'
import { callAI } from '../lib/ai.js'

// ─── JSON repair ──────────────────────────────────────────────────────────────

function repairAndParseJSON(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object found in AI response')
  let s = raw.slice(start, end + 1)
  try { return JSON.parse(s) } catch (e1) {
    s = s.replace(/,(\s*[}\]])/g, '$1')
    try { return JSON.parse(s) } catch (e2) {
      throw new Error('Parse failed after repair attempt: ' + e1.message)
    }
  }
}

// ─── History builder ──────────────────────────────────────────────────────────

function buildHistory(logs) {
  const now = Date.now()
  const daysAgo = d => (now - new Date(d + 'T12:00:00')) / 86400000
  const recent = logs.filter(l => daysAgo(l.date) <= 14)
  const older = logs.filter(l => daysAgo(l.date) > 14 && daysAgo(l.date) <= 60)

  const weeks = {}
  older.forEach(log => {
    const d = new Date(log.date + 'T12:00:00')
    d.setDate(d.getDate() - d.getDay())
    const wk = d.toISOString().split('T')[0]
    if (!weeks[wk]) weeks[wk] = []
    weeks[wk].push(log)
  })

  const summaries = Object.entries(weeks).map(([wk, wLogs]) => ({
    week_of: wk,
    sessions: wLogs.filter(l => l.pm_exercises?.length > 0).length,
    avg_feel: (wLogs.reduce((s, l) => s + (l.overall_feel || 0), 0) / wLogs.length).toFixed(1),
    avg_sleep: (wLogs.reduce((s, l) => s + (l.sleep_hours || 0), 0) / wLogs.length).toFixed(1),
    soreness_flags: [...new Set(wLogs.flatMap(l => Object.keys(l.soreness || {})))],
    adjustment_notes: wLogs.filter(l => l.adjustment_note).map(l => l.adjustment_note),
  }))

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

  return { recent, summaries, weights }
}

// ─── Week prompt ──────────────────────────────────────────────────────────────

const DAY_SCHEMA = `Each day must follow this structure:
{
  "label": "Monday - Push Day",
  "day_type": "training",
  "morning": {
    "label": "Hip Mobility + Kickboxing",
    "duration_min": 30,
    "type": "mobility",
    "focus": "hip flexors, glute activation",
    "exercises": [{"name":"90/90 Hip Stretch","sets":3,"reps":"60s each side","notes":"keep spine tall"}],
    "notes": "one coaching tip"
  },
  "afternoon": {
    "label": "Push - Chest, Shoulders, Triceps",
    "duration_min": 90,
    "type": "push",
    "focus": "hypertrophy",
    "muscle_groups": ["Chest","Shoulders","Triceps"],
    "warmup": [{"name":"Band pull-aparts","duration":"2 sets of 15"}],
    "exercises": [{"name":"DB Incline Press","sets":4,"reps":"10-12","weight_suggestion":"70lbs RPE 7","notes":"control eccentric"}],
    "finisher": {"name":"Cable lateral raise dropset","description":"3 weights back to back"},
    "notes": "one coaching tip"
  }
}
Sunday = active_recovery. Be concise: 3-4 morning exercises, 4-6 afternoon exercises, 2-3 warmup items.`

function buildWeekPrompt(profile, weekStart, logs) {
  const { recent, summaries, weights } = buildHistory(logs)
  const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
  const phaseWeek = getPhaseWeek(profile.phase_start)
  const prefs = profile.preferences || {}

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    days.push({ date: d.toISOString().split('T')[0], name: DAYS_FULL[d.getDay()] })
  }

  const system = 'You are a personal AI fitness coach. Athlete profile:\n' + ATHLETE_PROFILE +
    '\nCurrent weight: ' + profile.weight_lbs + 'lbs\nPhase: ' + phase.label + ' (Week ' + phaseWeek + ')' +
    '\nActivity targets: Swim ' + (prefs.swim_per_week || 2) + 'x/week, Basketball ' + (prefs.basketball_per_week || 1) + 'x/week, Kickboxing ' + (prefs.kickboxing_per_week || 3) + 'x/week mornings.\n\n' +
    DAY_SCHEMA + '\n\nRESPOND ONLY WITH VALID JSON. Start with { end with }. No markdown.'

  const user = 'Generate a 7-day training plan for week starting ' + weekStart + '.\n\n' +
    'RECENT LOGS (last 14 days):\n' + (recent.length > 0 ? JSON.stringify(recent.map(l => ({ date: l.date, sleep_hours: l.sleep_hours, overall_feel: l.overall_feel, morning_type: l.morning_type, pm_exercises: l.pm_exercises, pm_feel: l.pm_feel, soreness: l.soreness, adjustment_note: l.adjustment_note }))) : 'No history yet.') + '\n\n' +
    'OLDER HISTORY SUMMARY:\n' + (summaries.length > 0 ? JSON.stringify(summaries) : 'None.') + '\n\n' +
    'LAST LOGGED WEIGHTS (increase 2.5-5lbs or 1 rep for progressive overload):\n' + (Object.keys(weights).length > 0 ? JSON.stringify(weights) : 'None yet.') + '\n\n' +
    'DAYS: ' + days.map(d => d.date + ' (' + d.name + ')').join(', ') + '\n\n' +
    'RULES: Sunday = active recovery only. Never same muscle group consecutive days. Distribute swim ' + (prefs.swim_per_week || 2) + 'x, basketball ' + (prefs.basketball_per_week || 1) + 'x, kickboxing ' + (prefs.kickboxing_per_week || 3) + 'x morning. Hip mobility EVERY morning. Core 3+ days.\n\n' +
    'Return: {"week_start":"' + weekStart + '","phase_note":"...","days":{"' + days[0].date + '":{day},"' + days[1].date + '":{day},"' + days[2].date + '":{day},"' + days[3].date + '":{day},"' + days[4].date + '":{day},"' + days[5].date + '":{day},"' + days[6].date + '":{day}}}'

  return { system, user }
}

// ─── Components ───────────────────────────────────────────────────────────────

function ExerciseList({ exercises, color }) {
  if (!exercises?.length) return null
  return (
    <div>
      {exercises.map((ex, i) => {
        const isString = typeof ex === 'string'
        return (
          <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < exercises.length - 1 ? '1px solid ' + C.surfaceAlt : 'none' }}>
            {isString ? (
              <div style={{ fontSize: 14, color: C.text }}>{ex}</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, flex: 1, paddingRight: 8 }}>{ex.name}</div>
                  <div style={{ fontSize: 12, color, fontWeight: 700, whiteSpace: 'nowrap' }}>{ex.sets} × {ex.reps}</div>
                </div>
                {ex.weight_suggestion && <div style={{ fontSize: 12, color: C.orange, marginTop: 3 }}>🏋 {ex.weight_suggestion}</div>}
                {ex.notes && <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{ex.notes}</div>}
              </>
            )}
          </div>
        )
      })}
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
            <span className="badge" style={{ background: colorBadge + '22', color: colorBadge, border: '1px solid ' + colorBadge + '44' }}>{icon} {label}</span>
            <span style={{ fontSize: 12, color: C.muted }}>{session.duration_min}min</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{session.label}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{session.focus}</div>
        </div>
        <span style={{ color: C.muted, fontSize: 20, marginTop: 2 }}>{open ? '↑' : '↓'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 16, borderTop: '1px solid ' + C.border, paddingTop: 14 }}>
          {session.warmup?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="section-title">Warmup</div>
              {session.warmup.map((w, i) => (
                <div key={i} style={{ fontSize: 13, color: '#aaa', marginBottom: 4 }}>
                  {typeof w === 'string' ? '• ' + w : '• ' + w.name + ' — ' + w.duration}
                </div>
              ))}
            </div>
          )}
          {session.exercises?.length > 0 && (
            <>
              {session.warmup?.length > 0 && <div className="section-title" style={{ marginBottom: 10 }}>Main Work</div>}
              <ExerciseList exercises={session.exercises} color={colorBadge} />
            </>
          )}
          {session.finisher?.name && (
            <div style={{ background: C.redSoft, border: '1px solid ' + C.red + '33', borderRadius: 10, padding: '10px 12px', marginTop: 8 }}>
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

  const bodyParts = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Core', 'Glutes', 'Hips']

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
        {morningDone && <>
          <div style={{ marginBottom: 14 }}>
            <label className="label">What did you do? (e.g. "swam 1km", "kickboxing 3 rounds", "hip mobility")</label>
            <input className="input" value={morningType} onChange={e => setMorningType(e.target.value)} placeholder={dayPlan?.morning?.label || 'Describe session...'} />
          </div>
          <Slider label="How did it feel?" value={morningFeel} onChange={setMorningFeel} color={C.orange} />
          <label className="label">Notes</label>
          <input className="input" value={morningNotes} onChange={e => setMorningNotes(e.target.value)} placeholder="e.g. hips felt tight..." />
        </>}
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
              <div style={{ fontSize: 12, color: C.accent }}>{ex.sets}×{ex.reps}{ex.weight ? ' @ ' + ex.weight + 'lbs' : ''}</div>
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
        <input className="input" value={pmNotes} onChange={e => setPmNotes(e.target.value)} placeholder="e.g. shoulder felt strong..." style={{ marginBottom: 0 }} />
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: C.red, marginBottom: 14 }}>💢 Soreness Check</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {bodyParts.map(part => (
            <button key={part} onClick={() => setSoreness(s => ({ ...s, [part]: s[part] ? undefined : 7 }))}
              style={{ background: soreness[part] ? C.redSoft : C.surfaceAlt, border: '1px solid ' + (soreness[part] ? C.red : C.subtle), borderRadius: 20, padding: '6px 14px', fontSize: 12, color: soreness[part] ? C.red : C.muted, cursor: 'pointer', fontWeight: soreness[part] ? 700 : 400 }}>
              {part}
            </button>
          ))}
        </div>
        {Object.entries(soreness).filter(([, v]) => v).map(([part]) => (
          <div key={part} style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: C.muted }}>{part} soreness</span>
              <span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>{soreness[part]}/10</span>
            </div>
            <input type="range" min="1" max="10" value={soreness[part]} onChange={e => setSoreness(s => ({ ...s, [part]: parseInt(e.target.value) }))} style={{ width: '100%', accentColor: C.red }} />
          </div>
        ))}
      </div>

      <div className="card" style={{ background: C.yellowSoft, border: '1px solid ' + C.yellow + '33' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: C.yellow, marginBottom: 6 }}>⚡ Adjustment Flag</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          Did something happen that should change the rest of this week? After saving, you can confirm the adjustment.
        </div>
        <textarea className="input" value={adjustNote} onChange={e => setAdjustNote(e.target.value)}
          placeholder="e.g. swam 2km this morning, legs are wrecked — push leg day back&#10;e.g. tweaked left ankle, avoid jumping&#10;e.g. felt incredible, ready to push harder"
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
  const [adjustProgress, setAdjustProgress] = useState('')
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('plan')
  const [pendingAdjustment, setPendingAdjustment] = useState(null)
  const [adjustmentResult, setAdjustmentResult] = useState(null)

  const weekDates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    weekDates.push(d.toISOString().split('T')[0])
  }

  useEffect(() => { loadWeek() }, [])
  useEffect(() => { loadLog(selectedDate) }, [selectedDate])

  async function loadWeek() {
    const [plan, weekLogs] = await Promise.all([getWeekPlan(weekStart), getLogsForWeek(weekStart)])
    if (plan) setWeekPlan(plan)
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
      const allLogs = await getRecentLogs(60)
      const { system, user } = buildWeekPrompt(profile, weekStart, allLogs)
      const raw = await callAI(system, user, 7000)
      const data = repairAndParseJSON(raw)
      const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
      await saveWeekPlan(weekStart, data.days, phase.label, getPhaseWeek(profile.phase_start))
      setWeekPlan({ days: data.days, phase_note: data.phase_note })
    } catch (e) {
      setError(e.message)
    }
    setGenerating(false)
  }

  async function runAdjustment(note) {
    setAdjusting(true)
    setPendingAdjustment(null)
    setError(null)

    const remainingDays = weekDates.filter(d => d > today)
    if (remainingDays.length === 0) { setAdjusting(false); return }

    const logsThisWeek = Object.values(logs)
    const logSummary = logsThisWeek.map(l => ({
      date: l.date,
      morning: l.morning_type,
      pm: l.pm_type,
      soreness: Object.keys(l.soreness || {}).filter(k => (l.soreness[k] || 0) > 4),
      feel: l.overall_feel
    }))

    let updatedDays = { ...weekPlan.days }
    let successCount = 0

    for (const date of remainingDays) {
      const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
      setAdjustProgress('Adjusting ' + dayName + '...')

      const orig = weekPlan.days?.[date]
      const origInfo = orig
        ? (orig.label + ', morning: ' + (orig.morning?.type || 'mobility') + ', afternoon: ' + (orig.afternoon?.type || 'training') + ', muscles: ' + (orig.afternoon?.muscle_groups || []).join(', '))
        : 'no original plan'

      const systemPrompt = 'You are a personal AI fitness coach. ' + ATHLETE_PROFILE +
        ' CRITICAL: Respond with ONLY valid JSON. No markdown, no explanation. Start with { end with }.'

      const userPrompt = 'Generate an adjusted workout plan for ' + date + ' (' + dayName + ').\n' +
        'ADJUSTMENT REASON: "' + note + '"\n' +
        'DONE THIS WEEK: ' + JSON.stringify(logSummary) + '\n' +
        'ORIGINAL PLAN FOR TODAY: ' + origInfo + '\n\n' +
        'Return a single JSON object with this exact structure (exercises MUST be plain strings, not objects):\n' +
        '{\n' +
        '  "label": "' + dayName + ' - [session name]",\n' +
        '  "day_type": "training",\n' +
        '  "morning": {\n' +
        '    "label": "session name",\n' +
        '    "duration_min": 30,\n' +
        '    "focus": "focus area",\n' +
        '    "exercises": ["Exercise name 3x10", "Exercise name 3x60s each side"],\n' +
        '    "notes": "one tip"\n' +
        '  },\n' +
        '  "afternoon": {\n' +
        '    "label": "session name",\n' +
        '    "duration_min": 90,\n' +
        '    "focus": "focus area",\n' +
        '    "muscle_groups": ["Group1", "Group2"],\n' +
        '    "exercises": ["Exercise 4x10-12 @ 70lbs", "Exercise 3x8-10", "Exercise 3x15"],\n' +
        '    "notes": "one tip"\n' +
        '  }\n' +
        '}'

      try {
        const raw = await callAI(systemPrompt, userPrompt, 2000)
        const dayPlan = repairAndParseJSON(raw)
        updatedDays[date] = dayPlan
        successCount++
      } catch (e) {
        console.error('Failed to adjust ' + date + ':', e.message)
      }
    }

    setAdjustProgress('')

    if (successCount > 0) {
      try {
        await saveWeekPlan(weekStart, updatedDays, weekPlan.phase, weekPlan.phase_week)
        setWeekPlan(p => ({ ...p, days: updatedDays }))
        setAdjustmentResult(
          successCount === remainingDays.length
            ? 'All ' + successCount + ' remaining days adjusted. Tap the day tabs to see changes.'
            : successCount + ' of ' + remainingDays.length + ' days adjusted successfully.'
        )
      } catch (e) {
        setError('Adjusted but failed to save: ' + e.message)
      }
    } else {
      setError('Could not adjust any days. Your original plan is intact.')
    }

    setAdjusting(false)
  }

  async function handleSaveLog(entry) {
    await saveLog(entry)
    setLogs(l => ({ ...l, [entry.date]: entry }))
    setSelectedLog(entry)
    if (entry.adjustment_note?.trim() && weekPlan && weekDates.filter(d => d > today).length > 0) {
      setPendingAdjustment(entry.adjustment_note)
    }
  }

  const isSunday = new Date().getDay() === 0
  const selectedDay = weekPlan?.days?.[selectedDate]
  const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
  const phaseWeek = getPhaseWeek(profile.phase_start)

  function dayStatus(date) {
    if (logs[date]?.overall_feel) return 'logged'
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
          <span className="badge" style={{ background: phase.color + '22', color: phase.color, border: '1px solid ' + phase.color + '44' }}>
            {phase.label} · W{phaseWeek}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {weekDates.map((date, i) => {
            const status = dayStatus(date)
            const isToday = date === today
            const isSelected = date === selectedDate
            return (
              <button key={date} onClick={() => setSelectedDate(date)} style={{
                flex: 1, background: isSelected ? C.accent : 'transparent',
                border: '1px solid ' + (isToday && !isSelected ? C.accent : isSelected ? C.accent : C.border),
                borderRadius: 10, padding: '6px 0', cursor: 'pointer', transition: 'all 0.15s'
              }}>
                <div style={{ fontSize: 10, color: isSelected ? '#fff' : C.muted, marginBottom: 3 }}>{DAYS[i]}</div>
                <div style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isSelected ? '#fff' : isToday ? C.accent : C.text }}>
                  {new Date(date + 'T12:00:00').getDate()}
                </div>
                <div style={{ marginTop: 3 }}>
                  {status === 'logged' && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, margin: '0 auto' }} />}
                  {status === 'planned' && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.muted, margin: '0 auto' }} />}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ paddingTop: 16 }}>

        {pendingAdjustment && !adjusting && (
          <div className="card" style={{ background: C.yellowSoft, border: '1px solid ' + C.yellow + '44' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.yellow, marginBottom: 8 }}>⚡ Adjustment Flagged</div>
            <div style={{ fontSize: 13, color: '#ddd', marginBottom: 4, fontStyle: 'italic' }}>"{pendingAdjustment}"</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              Rebuild remaining {weekDates.filter(d => d > today).length} days based on this? Takes ~30 seconds.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={() => runAdjustment(pendingAdjustment)} style={{ margin: 0, flex: 1, background: C.yellow, color: '#000' }}>
                Yes, adjust my week
              </button>
              <button className="btn-secondary" onClick={() => setPendingAdjustment(null)} style={{ margin: 0, flex: 1 }}>
                No thanks
              </button>
            </div>
          </div>
        )}

        {adjusting && (
          <div className="card" style={{ background: C.yellowSoft, border: '1px solid ' + C.yellow + '44', textAlign: 'center', padding: '20px 18px' }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>⚡</div>
            <div style={{ fontSize: 14, color: C.yellow, fontWeight: 600, marginBottom: 4 }}>Adjusting your week...</div>
            <div style={{ fontSize: 12, color: C.muted }}>{adjustProgress || 'Building each remaining day...'}</div>
          </div>
        )}

        {adjustmentResult && (
          <div className="card" style={{ background: C.greenSoft, border: '1px solid ' + C.green + '44' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>✓ WEEK ADJUSTED</div>
            <div style={{ fontSize: 13, color: '#ddd', marginBottom: 8 }}>{adjustmentResult}</div>
            <button onClick={() => setAdjustmentResult(null)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', padding: 0 }}>Dismiss</button>
          </div>
        )}

        {!weekPlan && !generating && (
          <div className="card" style={{ textAlign: 'center', padding: '28px 18px', background: isSunday ? C.accentSoft : undefined, border: isSunday ? '1px solid ' + C.accent + '44' : undefined }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{isSunday ? '📅' : '🤖'}</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{isSunday ? "It's Sunday — Generate This Week" : 'No Plan for This Week'}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
              AI will plan your full week using your last 60 days of history.
            </div>
            <button className="btn-primary" onClick={generateWeek} style={{ width: 'auto', padding: '12px 28px', marginBottom: 0 }}>
              Generate Week ⚡
            </button>
          </div>
        )}

        {generating && (
          <div className="card" style={{ textAlign: 'center', padding: '24px 18px' }}>
            <div style={{ fontSize: 24, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 13, color: C.muted }}>Building your 7-day plan...</div>
          </div>
        )}

        {error && (
          <div className="card" style={{ background: C.redSoft, border: '1px solid ' + C.red + '44' }}>
            <div style={{ fontSize: 13, color: C.red, marginBottom: 6 }}>⚠️ {error}</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Your existing plan is still saved and intact.</div>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer', padding: 0 }}>Dismiss</button>
          </div>
        )}

        {weekPlan?.phase_note && (
          <div className="card" style={{ background: C.accentSoft, border: '1px solid ' + C.accent + '44' }}>
            <div style={{ fontSize: 12, color: '#9c8fff' }}>📍 {weekPlan.phase_note}</div>
          </div>
        )}

        {weekPlan && (
          <>
            <div style={{ padding: '0 16px 4px' }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {selectedDate === today && <span style={{ fontSize: 12, color: C.accent, marginLeft: 8 }}>· Today</span>}
              </div>
              {selectedDay?.label && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{selectedDay.label}</div>}
            </div>

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
                  <div className="card" style={{ background: C.greenSoft, border: '1px solid ' + C.green + '44' }}>
                    <div style={{ fontSize: 12, color: C.green }}>
                      ✓ Logged · Feel: {logs[selectedDate].overall_feel}/10
                      {logs[selectedDate].pm_type ? ' · ' + logs[selectedDate].pm_type : ''}
                    </div>
                  </div>
                )}
                {selectedDay ? (
                  <>
                    <SessionCard session={selectedDay.morning} colorBadge={C.orange} label="Morning" icon="🌅" />
                    <SessionCard session={selectedDay.afternoon} colorBadge={C.accent} label="Afternoon" icon="🏋️" defaultOpen={selectedDate === today} />
                  </>
                ) : (
                  <div className="card" style={{ textAlign: 'center', color: C.muted, padding: '24px 18px' }}>No plan for this day.</div>
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
