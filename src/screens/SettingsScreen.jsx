import { useState } from 'react'
import { C, PHASES, getPhaseWeek } from '../lib/constants.js'
import { saveProfile } from '../lib/supabase.js'

export default function SettingsScreen({ profile, onProfileUpdate }) {
  const [weight, setWeight] = useState(profile?.weight_lbs?.toString() || '220')
  const [selectedPhase, setSelectedPhase] = useState(profile?.phase || 'athletic_hypertrophy')
  const [prefs, setPrefs] = useState(profile?.preferences || { swim_per_week: 2, basketball_per_week: 1, kickboxing_per_week: 3, sleep_target: 7 })
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)

  const phase = PHASES.find(p => p.id === profile?.phase) || PHASES[0]
  const phaseWeek = getPhaseWeek(profile?.phase_start)

  async function saveChanges(resetPhase = false) {
    setSaving(true)
    try {
      const updates = {
        weight_lbs: parseFloat(weight),
        phase: selectedPhase,
        preferences: prefs,
        ...(resetPhase || selectedPhase !== profile.phase ? { phase_start: new Date().toISOString().split('T')[0] } : {})
      }
      await saveProfile(updates)
      onProfileUpdate({ ...profile, ...updates })
      setSaved('saved')
      setTimeout(() => setSaved(null), 2000)
    } catch (e) {
      setSaved('error')
    }
    setSaving(false)
  }

  const activityPrefs = [
    { label: '🏊 Swim sessions/week', key: 'swim_per_week', min: 0, max: 4 },
    { label: '🏀 Basketball sessions/week', key: 'basketball_per_week', min: 0, max: 3 },
    { label: '🥊 Kickboxing sessions/week', key: 'kickboxing_per_week', min: 0, max: 5 },
    { label: '😴 Sleep target (hours)', key: 'sleep_target', min: 6, max: 9, step: 0.5 },
  ]

  return (
    <div className="screen">
      <div className="header">
        <div style={{ fontWeight: 800, fontSize: 17 }}>⚙️ Settings</div>
      </div>

      <div style={{ paddingTop: 16 }}>
        {/* Current phase */}
        <div className="card" style={{ background: phase.color + '18', border: `1px solid ${phase.color}44` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Current Phase</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: phase.color }}>{phase.label}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Week {phaseWeek} · Started {new Date((profile?.phase_start || new Date()) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        </div>

        {/* Weight */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Current Weight</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input className="input" type="number" value={weight} onChange={e => setWeight(e.target.value)} style={{ width: 120 }} />
            <span style={{ fontSize: 14, color: C.muted }}>lbs</span>
          </div>
        </div>

        {/* Phase */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Training Phase</div>
          {PHASES.map(p => (
            <div key={p.id} onClick={() => setSelectedPhase(p.id)} style={{
              background: selectedPhase === p.id ? p.color + '18' : C.surfaceAlt,
              border: `1px solid ${selectedPhase === p.id ? p.color : C.subtle}`,
              borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', transition: 'all 0.2s'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: selectedPhase === p.id ? p.color : C.text }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{p.desc} · {p.weeks} weeks</div>
                </div>
                {selectedPhase === p.id && <span style={{ color: p.color }}>✓</span>}
              </div>
            </div>
          ))}
          {selectedPhase !== profile?.phase && (
            <div style={{ fontSize: 12, color: C.orange, marginTop: 4 }}>⚠️ Changing phase will reset your week counter to Week 1</div>
          )}
        </div>

        {/* Activity preferences */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Weekly Activity Targets</div>
          {activityPrefs.map(f => (
            <div key={f.key} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="label">{f.label}</label>
                <span style={{ fontSize: 14, color: C.accent, fontWeight: 700 }}>
                  {prefs[f.key]}{f.key === 'sleep_target' ? 'h' : 'x'}
                </span>
              </div>
              <input type="range" min={f.min} max={f.max} step={f.step || 1} value={prefs[f.key]}
                style={{ width: '100%', accentColor: C.accent }}
                onChange={e => setPrefs(p => ({ ...p, [f.key]: parseFloat(e.target.value) }))} />
            </div>
          ))}
        </div>

        {/* Profile summary */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Your Profile</div>
          {[
            ['Age', `${profile?.age}`],
            ['Height', profile?.height],
            ['Goal', profile?.goal],
            ['Home Gym', 'Cables, bench, pullup bar, bag'],
            ['Commercial Gym', 'Full equipment, pool, court'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.surfaceAlt}`, fontSize: 13 }}>
              <span style={{ color: C.muted, flexShrink: 0, marginRight: 16 }}>{k}</span>
              <span style={{ fontWeight: 600, textAlign: 'right', color: C.text }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '0 16px' }}>
          <button className="btn-primary" disabled={saving} onClick={() => saveChanges()}
            style={{ background: saved === 'saved' ? C.green : saved === 'error' ? C.red : C.accent }}>
            {saving ? 'Saving...' : saved === 'saved' ? '✓ Saved!' : saved === 'error' ? 'Error — try again' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
