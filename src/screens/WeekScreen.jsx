import { useState, useEffect } from 'react'
import { C, DAYS, DAYS_FULL, getWeekStart, todayStr, getPhaseWeek, PHASES, ATHLETE_PROFILE } from '../lib/constants.js'
import { getWeekPlan, saveWeekPlan, getLogsForWeek, saveLog, getRecentLogs } from '../lib/supabase.js'
import { callAI, repairAndParseJSON } from '../lib/ai.js'

// ─── Week prompt ──────────────────────────────────────────────────────────────

const DAY_SCHEMA = `Each day uses this structure. Exercises and warmup are PLAIN STRINGS not objects.
{
  "label": "Monday - Push Day",
  "day_type": "training",
  "morning": {
    "label": "Hip Mobility + Kickboxing",
    "duration_min": 30,
    "type": "mobility",
    "focus": "hip flexors and glutes",
    "exercises": ["90/90 Hip Stretch 3x60s each side", "Tibialis raise 3x20", "Kickboxing 3x2min rounds"],
    "notes": "keep it light fasted"
  },
  "afternoon": {
    "label": "Push - Chest Shoulders Triceps",
    "duration_min": 90,
    "type": "push",
    "focus": "hypertrophy",
    "muscle_groups": ["Chest","Shoulders","Triceps"],
    "warmup": ["Band pull-aparts 2x15", "Light cable fly 2x15"],
    "exercises": ["DB Incline Press 4x10-12 @ 70lbs", "Cable lateral raise 3x15 @ 20lbs", "Overhead tricep ext 3x12 @ 50lbs", "Face pulls 3x15"],
    "finisher": {"name": "Lateral raise dropset", "description": "3 weights back to back no rest"},
    "notes": "protect left pec"
  }
}
Sunday = active_recovery only. Be concise: 3-4 morning exercises, 4-6 afternoon exercises, 2-3 warmup items.`

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
    notable_notes: wLogs.filter(l => l.pm_notes || l.morning_notes).map(l => l.pm_notes || l.morning_notes).filter(Boolean).slice(0, 3),
  }))

  const weights = {}
  logs.forEach(log => {
    if (log.pm_exercises) {
      log.pm_exercises.forEach(ex => {
        if (ex.weight && ex.name) {
          if (!weights[ex.name] || new Date(log.date) > new Date(weights[ex.name].date)) {
            weights[ex.name] = { weight: ex.weight, reps: ex.reps || ex.actual_reps, date: log.date }
          }
        }
      })
    }
  })

  return { recent, summaries, weights }
}

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

  // Compact recent logs — include ALL notes
  const recentCompact = recent.map(l => ({
    date: l.date,
    sleep: l.sleep_hours,
    feel: l.overall_feel,
    morning: l.morning_done ? (l.morning_notes || l.morning_type || 'done') : 'skipped',
    exercises: (l.pm_exercises || []).map(ex => ex.name + (ex.weight ? ' @' + ex.weight + 'lbs' : '') + (ex.completed === false ? ' (skipped)' : '') + (ex.note ? ' [' + ex.note + ']' : '')).filter(Boolean),
    notes: [l.pm_notes, l.morning_notes].filter(Boolean).join(' | ') || null,
  }))

  const system = 'You are a personal AI fitness coach and nutritionist. Athlete profile:\n' + ATHLETE_PROFILE +
    '\nCurrent weight: ' + profile.weight_lbs + 'lbs | Phase: ' + phase.label + ' Week ' + phaseWeek +
    '\nSwim ' + (prefs.swim_per_week || 2) + 'x/week, Basketball ' + (prefs.basketball_per_week || 1) + 'x/week, Kickboxing ' + (prefs.kickboxing_per_week || 3) + 'x/week mornings.\n\n' +
    DAY_SCHEMA + '\n\nRESPOND ONLY WITH VALID JSON. Start with { end with }. No markdown.'

  const user = 'Generate a 7-day training plan for week starting ' + weekStart + '.\n\n' +
    'RECENT LOGS (last 14 days — all notes included for context):\n' +
    JSON.stringify(recentCompact) + '\n\n' +
    'WEEKLY SUMMARIES (older history):\n' +
    (summaries.length ? JSON.stringify(summaries) : 'None yet.') + '\n\n' +
    'LAST LOGGED WEIGHTS (for progressive overload — increase 2.5-5lbs or add 1 rep):\n' +
    (Object.keys(weights).length ? JSON.stringify(weights) : 'None yet — suggest starting weights by RPE.') + '\n\n' +
    'DAYS TO PLAN: ' + days.map(d => d.date + ' (' + d.name + ')').join(', ') + '\n\n' +
    'RULES: Sunday active recovery only. Never same muscle group consecutive days. ' +
    'Hip mobility EVERY morning. Core 3+ days. Account for any notes/injuries from recent logs.\n\n' +
    'Return JSON with this exact structure:\n' +
    '{\n' +
    '  "week_start": "' + weekStart + '",\n' +
    '  "phase_note": "one sentence on this week focus",\n' +
    '  "days": {\n' +
    '    "' + days[0].date + '": { label, day_type, morning, afternoon },\n' +
    '    "' + days[1].date + '": { label, day_type, morning, afternoon },\n' +
    '    "' + days[2].date + '": { label, day_type, morning, afternoon },\n' +
    '    "' + days[3].date + '": { label, day_type, morning, afternoon },\n' +
    '    "' + days[4].date + '": { label, day_type, morning, afternoon },\n' +
    '    "' + days[5].date + '": { label, day_type, morning, afternoon },\n' +
    '    "' + days[6].date + '": { label, day_type, morning, afternoon }\n' +
    '  }\n' +
    '}'

  return { system, user }
}

// ─── Exercise helpers ─────────────────────────────────────────────────────────

function parseExerciseString(str) {
  if (typeof str !== 'string') return { name: str?.name || '', planned: '', weight: '', reps: '' }
  const weightMatch = str.match(/@\s*(\d+)\s*lbs?/i)
  const setsRepsMatch = str.match(/(\d+)x([\d\-]+)/i)
  const name = str.replace(/\s*\d+x[\d\-]+.*$/i, '').replace(/\s*@.*$/i, '').trim()
  return {
    name: name || str,
    planned: str,
    weight: weightMatch ? weightMatch[1] : '',
    reps: setsRepsMatch ? setsRepsMatch[2] : '',
  }
}

function initExercises(plan, log) {
  const planExs = plan?.afternoon?.exercises || []
  const logExs = log?.pm_exercises || []
  return planExs.map((planEx, i) => {
    const parsed = parseExerciseString(planEx)
    const logEx = logExs.find(l => l.name && parsed.name && l.name.toLowerCase().startsWith(parsed.name.toLowerCase().slice(0, 6)))
    return {
      id: i,
      name: parsed.name,
      planned: parsed.planned,
      weight: logEx?.weight || parsed.weight,
      reps: logEx?.reps || logEx?.actual_reps || parsed.reps,
      completed: logEx ? (logEx.completed ?? true) : false,
      note: logEx?.note || '',
    }
  })
}

// ─── Components ───────────────────────────────────────────────────────────────

function ExerciseDisplay({ exercises, color }) {
  if (!exercises?.length) return null
  return (
    <div>
      {exercises.map((ex, i) => (
        <div key={i} style={{ fontSize: 13, color: C.text, padding: '6px 0', borderBottom: i < exercises.length - 1 ? '1px solid ' + C.surfaceAlt : 'none' }}>
          {typeof ex === 'string' ? ex : ex.name}
        </div>
      ))}
    </div>
  )
}

function SessionReadOnly({ session, colorBadge, label, icon }) {
  const [open, setOpen] = useState(false)
  if (!session) return null
  return (
    <div className="card">
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className="badge" style={{ background: colorBadge + '22', color: colorBadge, border: '1px solid ' + colorBadge + '44' }}>{icon} {label}</span>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 5 }}>{session.label}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{session.focus}</div>
        </div>
        <span style={{ color: C.muted }}>{open ? '↑' : '↓'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14, borderTop: '1px solid ' + C.border, paddingTop: 12 }}>
          {session.warmup?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="section-title">Warmup</div>
              {session.warmup.map((w, i) => <div key={i} style={{ fontSize: 12, color: '#aaa', marginBottom: 3 }}>• {typeof w === 'string' ? w : w.name + ' — ' + w.duration}</div>)}
            </div>
          )}
          <ExerciseDisplay exercises={session.exercises} color={colorBadge} />
          {session.finisher?.name && (
            <div style={{ background: C.redSoft, borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 3 }}>FINISHER 🔥</div>
              <div style={{ fontSize: 13 }}>{session.finisher.name} — {session.finisher.description}</div>
            </div>
          )}
          {session.notes && <div style={{ fontSize: 12, color: '#9c8fff', background: C.accentSoft, borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>💬 {session.notes}</div>}
        </div>
      )}
    </div>
  )
}

// Combined plan + log view for a day
function DayView({ date, plan, log, onSave, weekDates }) {
  const today = todayStr()
  const isToday = date === today
  const isFuture = date > today

  // key={date} on this component handles state reset between days

  const [morningDone, setMorningDone] = useState(log?.morning_done || false)
  const [morningNote, setMorningNote] = useState(log?.morning_notes || '')
  const [exercises, setExercises] = useState(() => initExercises(plan, log))
  const [sleep, setSleep] = useState(log?.sleep_hours?.toString() || '')
  const [feel, setFeel] = useState(log?.overall_feel?.toString() || '7')
  const [notes, setNotes] = useState(log?.pm_notes || '')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  function updateEx(id, field, value) {
    setExercises(exs => exs.map(ex => ex.id === id ? { ...ex, [field]: value } : ex))
  }

  async function handleSave() {
    setSaving(true)
    const pm_exercises = exercises.map(ex => ({
      name: ex.name,
      planned: ex.planned,
      weight: ex.weight,
      reps: ex.reps,
      completed: ex.completed,
      note: ex.note,
    }))

    const entry = {
      date,
      sleep_hours: parseFloat(sleep) || null,
      overall_feel: parseInt(feel) || null,
      morning_done: morningDone,
      morning_notes: morningNote,
      pm_exercises,
      pm_notes: notes,
    }

    await onSave(entry)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
  }

  if (isFuture) {
    return (
      <div>
        <SessionReadOnly session={plan?.morning} colorBadge={C.orange} label="Morning" icon="🌅" />
        <SessionReadOnly session={plan?.afternoon} colorBadge={C.accent} label="Afternoon" icon="🏋️" />
        {!plan && <div className="card" style={{ textAlign: 'center', color: C.muted, padding: 24 }}>No plan yet for this day.</div>}
      </div>
    )
  }

  return (
    <div>
      {/* Morning */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <span className="badge" style={{ background: C.orangeSoft, color: C.orange, border: '1px solid ' + C.orange + '44' }}>🌅 Morning</span>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 5 }}>{plan?.morning?.label || 'Morning Session'}</div>
            {plan?.morning?.focus && <div style={{ fontSize: 12, color: C.muted }}>{plan.morning.focus}</div>}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
            <input type="checkbox" checked={morningDone} onChange={e => setMorningDone(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.green }} />
            <span style={{ fontSize: 12, color: morningDone ? C.green : C.muted }}>Done</span>
          </label>
        </div>

        {plan?.morning?.exercises?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="section-title">Planned</div>
            {plan.morning.exercises.map((ex, i) => (
              <div key={i} style={{ fontSize: 12, color: '#aaa', padding: '4px 0', borderBottom: '1px solid ' + C.surfaceAlt }}>
                {typeof ex === 'string' ? ex : ex.name}
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="label">Notes (e.g. "swam instead", "hips felt tight", "skipped — tired")</label>
          <input className="input" value={morningNote} onChange={e => setMorningNote(e.target.value)} placeholder="How did it go?" />
        </div>
      </div>

      {/* Afternoon */}
      <div className="card">
        <div style={{ marginBottom: 14 }}>
          <span className="badge" style={{ background: C.accentSoft, color: C.accent, border: '1px solid ' + C.accent + '44' }}>🏋️ Afternoon</span>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 5 }}>{plan?.afternoon?.label || 'Afternoon Session'}</div>
          {plan?.afternoon?.muscle_groups?.length > 0 && (
            <div style={{ fontSize: 12, color: C.muted }}>{plan.afternoon.muscle_groups.join(', ')}</div>
          )}
        </div>

        {plan?.afternoon?.warmup?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="section-title">Warmup</div>
            {plan.afternoon.warmup.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: '#aaa', padding: '3px 0' }}>
                • {typeof w === 'string' ? w : w.name + ' — ' + w.duration}
              </div>
            ))}
          </div>
        )}

        {exercises.length > 0 ? (
          <div>
            <div className="section-title">Exercises — tap to log</div>
            {exercises.map(ex => (
              <div key={ex.id} style={{
                background: ex.completed ? C.accentSoft : C.surfaceAlt,
                border: '1px solid ' + (ex.completed ? C.accent + '44' : C.subtle),
                borderRadius: 12, padding: '10px 12px', marginBottom: 8, transition: 'all 0.15s'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: ex.completed ? 8 : 0 }}>
                  <input type="checkbox" checked={ex.completed} onChange={e => updateEx(ex.id, 'completed', e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: C.accent, marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{ex.name}</div>
                    {ex.planned && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Planned: {ex.planned}</div>}
                  </div>
                </div>
                {ex.completed && (
                  <div style={{ paddingLeft: 28 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>
                        <label className="label">Actual Weight (lbs)</label>
                        <input className="input" type="number" value={ex.weight} onChange={e => updateEx(ex.id, 'weight', e.target.value)} placeholder="lbs" />
                      </div>
                      <div>
                        <label className="label">Reps Done</label>
                        <input className="input" value={ex.reps} onChange={e => updateEx(ex.id, 'reps', e.target.value)} placeholder="e.g. 12" />
                      </div>
                    </div>
                    <input className="input" value={ex.note} onChange={e => updateEx(ex.id, 'note', e.target.value)}
                      placeholder="Note (e.g. felt heavy, form broke down...)" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div>
            <label className="label">What did you do?</label>
            <input className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. push day, swam 1km, basketball..." />
          </div>
        )}

        {plan?.afternoon?.finisher?.name && (
          <div style={{ background: C.redSoft, borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 3 }}>FINISHER 🔥</div>
            <div style={{ fontSize: 13 }}>{plan.afternoon.finisher.name} — {plan.afternoon.finisher.description}</div>
          </div>
        )}
      </div>

      {/* Day summary */}
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, color: C.muted, marginBottom: 14 }}>📋 Day Summary</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label className="label">Sleep (hours)</label>
            <input className="input" type="number" step="0.5" value={sleep} onChange={e => setSleep(e.target.value)} placeholder="7.5" />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="label">Overall Feel</label>
              <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{feel}/10</span>
            </div>
            <input type="range" min="1" max="10" value={feel} onChange={e => setFeel(e.target.value)} style={{ width: '100%', accentColor: C.green }} />
          </div>
        </div>

        <div>
          <label className="label">Notes — injuries, energy, what was different, anything to flag</label>
          <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. left shoulder felt off on pressing, might need to take it easy tomorrow&#10;e.g. swam 2km this morning so legs were tired&#10;e.g. crushed it today, ready to push harder this week"
            style={{ height: 80, resize: 'none', marginBottom: 0 }} />
        </div>
      </div>

      {log?.overall_feel && (
        <div className="card" style={{ background: C.greenSoft, border: '1px solid ' + C.green + '33' }}>
          <div style={{ fontSize: 12, color: C.green }}>✓ Previously logged — saving will update this entry</div>
        </div>
      )}

      <div style={{ padding: '0 16px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving}
          style={{ background: saved ? C.green : C.accent }}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : isToday ? 'Save Today\'s Log' : 'Save Log'}
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
  const [generating, setGenerating] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [adjustProgress, setAdjustProgress] = useState('')
  const [error, setError] = useState(null)
  const [pendingAdjustment, setPendingAdjustment] = useState(null)
  const [adjustmentResult, setAdjustmentResult] = useState(null)

  const weekDates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    weekDates.push(d.toISOString().split('T')[0])
  }

  useEffect(() => { loadWeek() }, [])

  async function loadWeek() {
    const [plan, weekLogs] = await Promise.all([getWeekPlan(weekStart), getLogsForWeek(weekStart)])
    if (plan) setWeekPlan(plan)
    const logMap = {}
    weekLogs.forEach(l => { logMap[l.date] = l })
    setLogs(logMap)
  }

  async function generateWeek() {
    setGenerating(true)
    setError(null)
    try {
      const allLogs = await getRecentLogs(60)
      const { system, user } = buildWeekPrompt(profile, weekStart, allLogs)
      const raw = await callAI(system, user, 8000)
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
    if (!remainingDays.length) { setAdjusting(false); return }

    const logsThisWeek = Object.values(logs)
    const logSummary = logsThisWeek.map(l => ({
      date: l.date,
      morning: l.morning_done ? (l.morning_notes || 'done') : 'skipped',
      feel: l.overall_feel,
      notes: l.pm_notes || null,
    }))

    let updatedDays = { ...weekPlan.days }
    let successCount = 0

    for (const date of remainingDays) {
      const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
      setAdjustProgress('Adjusting ' + dayName + '...')

      const orig = weekPlan.days?.[date]
      const origInfo = orig ? orig.label + ', morning: ' + (orig.morning?.type || 'mobility') + ', afternoon: ' + (orig.afternoon?.type || 'training') + ', muscles: ' + (orig.afternoon?.muscle_groups || []).join(', ') : 'no plan'

      const sys = 'You are a personal AI fitness coach. ' + ATHLETE_PROFILE + ' Respond ONLY with valid JSON. Start with { end with }. No markdown.'
      const usr = 'Adjusted plan for ' + date + ' (' + dayName + ').\n' +
        'Reason: "' + note + '"\n' +
        'Week logs: ' + JSON.stringify(logSummary) + '\n' +
        'Original: ' + origInfo + '\n\n' +
        'Return ONE JSON object. Exercises as plain strings:\n' +
        '{"label":"' + dayName + ' - session","day_type":"training","morning":{"label":"","duration_min":30,"focus":"","exercises":["Ex 3x10","Ex 3x60s"],"notes":""},"afternoon":{"label":"","duration_min":90,"focus":"","muscle_groups":["G1"],"exercises":["Ex 4x10-12 @ 70lbs","Ex 3x8-10"],"notes":""}}'

      try {
        const raw = await callAI(sys, usr, 2000)
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
        setAdjustmentResult('Week adjusted — ' + successCount + ' day' + (successCount > 1 ? 's' : '') + ' updated. Tap the day tabs to see changes.')
      } catch (e) {
        setError('Adjusted but failed to save: ' + e.message)
      }
    } else {
      setError('Could not adjust any days. Your original plan is intact.')
    }
    setAdjusting(false)
  }

  async function inferAdjustment(entry) {
    const remainingDays = weekDates.filter(d => d > today)
    if (!remainingDays.length || !weekPlan) return

    const hasNotes = entry.pm_notes?.trim()
    const hasExerciseNotes = (entry.pm_exercises || []).some(ex => ex.note)
    const hasSkippedExercises = (entry.pm_exercises || []).some(ex => ex.completed === false)

    if (!hasNotes && !hasExerciseNotes && !hasSkippedExercises) return

    const summary = [
      entry.pm_notes ? 'Notes: ' + entry.pm_notes : '',
      entry.morning_notes ? 'Morning notes: ' + entry.morning_notes : '',
      hasExerciseNotes ? 'Exercise notes: ' + (entry.pm_exercises || []).filter(e => e.note).map(e => e.name + ': ' + e.note).join(', ') : '',
      hasSkippedExercises ? 'Skipped: ' + (entry.pm_exercises || []).filter(e => !e.completed).map(e => e.name).join(', ') : '',
    ].filter(Boolean).join('\n')

    try {
      const sys = 'You are a personal trainer reading a training log. Respond ONLY with valid JSON. Start with { end with }.'
      const usr = 'Training log for today:\n' + summary + '\n\nRemaining days this week: ' + remainingDays.join(', ') + '\n\nShould any remaining days be adjusted? Reply:\n{"needs_adjustment": true, "reason": "one sentence", "suggestion": "one specific sentence what to change"}\nOR\n{"needs_adjustment": false}'

      const raw = await callAI(sys, usr, 300)
      const decision = repairAndParseJSON(raw)
      if (decision.needs_adjustment) {
        setPendingAdjustment(decision)
      }
    } catch (e) {
      // Silent fail — inference is optional
      console.log('Inference failed silently:', e.message)
    }
  }

  async function handleSaveLog(entry) {
    await saveLog(entry)
    setLogs(l => ({ ...l, [entry.date]: entry }))
    // Run inference silently — show banner if adjustment needed
    inferAdjustment(entry)
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
        {/* Status banners */}
        {pendingAdjustment && !adjusting && (
          <div className="card" style={{ background: C.yellowSoft, border: '1px solid ' + C.yellow + '44' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.yellow, marginBottom: 6 }}>⚡ Trainer Recommendation</div>
            <div style={{ fontSize: 13, color: '#ddd', marginBottom: 4 }}>{pendingAdjustment.reason}</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>{pendingAdjustment.suggestion}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={() => runAdjustment(pendingAdjustment.reason + ' ' + pendingAdjustment.suggestion)}
                style={{ margin: 0, flex: 1, background: C.yellow, color: '#000', fontSize: 13 }}>
                Adjust my week
              </button>
              <button className="btn-secondary" onClick={() => setPendingAdjustment(null)} style={{ margin: 0, flex: 1, fontSize: 13 }}>
                Keep as is
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
            <div style={{ fontSize: 12, color: C.green, marginBottom: 6 }}>✓ {adjustmentResult}</div>
            <button onClick={() => setAdjustmentResult(null)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', padding: 0 }}>Dismiss</button>
          </div>
        )}

        {!weekPlan && !generating && (
          <div className="card" style={{ textAlign: 'center', padding: '28px 18px', background: isSunday ? C.accentSoft : undefined, border: isSunday ? '1px solid ' + C.accent + '44' : undefined }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{isSunday ? '📅' : '🤖'}</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{isSunday ? "It's Sunday — Generate This Week" : 'No Plan for This Week'}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>AI will plan your full week using your last 60 days of history.</div>
            <button className="btn-primary" onClick={generateWeek} style={{ width: 'auto', padding: '12px 28px', marginBottom: 0 }}>Generate Week ⚡</button>
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
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Your existing plan is safe.</div>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', padding: 0 }}>Dismiss</button>
          </div>
        )}

        {weekPlan?.phase_note && (
          <div className="card" style={{ background: C.accentSoft, border: '1px solid ' + C.accent + '44' }}>
            <div style={{ fontSize: 12, color: '#9c8fff' }}>📍 {weekPlan.phase_note}</div>
          </div>
        )}

        {/* Day header */}
        {weekPlan && (
          <div style={{ padding: '4px 16px 8px' }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {selectedDate === today && <span style={{ fontSize: 12, color: C.accent, marginLeft: 8 }}>· Today</span>}
            </div>
            {selectedDay?.label && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{selectedDay.label}</div>}
          </div>
        )}

        {/* Combined plan + log — key={selectedDate} resets state between days */}
        {weekPlan && (
          <DayView
            key={selectedDate}
            date={selectedDate}
            plan={selectedDay}
            log={logs[selectedDate]}
            onSave={handleSaveLog}
            weekDates={weekDates}
          />
        )}
      </div>
    </div>
  )
}
