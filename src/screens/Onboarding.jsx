import { useState } from 'react'
import { PHASES, C } from '../lib/constants.js'
import { saveProfile } from '../lib/supabase.js'

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    name: '', age: '26', weight_lbs: '220', height: "6'4\"",
    goal: 'Recomp — lose torso/chest fat, build arms/legs/shoulders',
    phase: 'athletic_hypertrophy',
    preferences: {
      swim_per_week: 2, basketball_per_week: 1, kickboxing_per_week: 3,
      rest_day_style: 'active', sleep_target: 7
    }
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function finish() {
    setSaving(true)
    try {
      await saveProfile({ ...form, age: parseInt(form.age), weight_lbs: parseFloat(form.weight_lbs), onboarded: true, phase_start: new Date().toISOString().split('T')[0] })
      onComplete()
    } catch (e) {
      alert('Error saving profile: ' + e.message)
    }
    setSaving(false)
  }

  const steps = [
    // Step 0 — Welcome
    <div key={0}>
      <div style={{ textAlign: 'center', padding: '60px 24px 40px' }}>
        <div style={{ fontSize: 72, marginBottom: 20, filter: 'drop-shadow(0 0 24px #8b7fff)' }}>⚡</div>
        <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 8, background: 'linear-gradient(135deg,#fff 0%,#c4b5ff 50%,#8b7fff 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 12 }}>IFit</div>
        <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>Your personal AI training system. Takes 60 seconds to set up — you'll only do this once.</div>
      </div>
      <div style={{ padding: '0 24px' }}>
        <button className="btn-primary" onClick={() => setStep(1)}>Let's go ⚡</button>
      </div>
    </div>,

    // Step 1 — Basic info
    <div key={1} style={{ padding: '0 24px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Basic Info</div>
      <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Already pre-filled from our setup — just confirm.</div>
      {[
        { label: 'Name', key: 'name', placeholder: 'Your name', type: 'text' },
        { label: 'Age', key: 'age', placeholder: '26', type: 'number' },
        { label: 'Height', key: 'height', placeholder: "6'4\"", type: 'text' },
        { label: 'Current Weight (lbs)', key: 'weight_lbs', placeholder: '220', type: 'number' },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 16 }}>
          <label className="label">{f.label}</label>
          <input className="input" type={f.type} value={form[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />
        </div>
      ))}
      <button className="btn-primary" onClick={() => setStep(2)}>Next →</button>
      <button className="btn-secondary" onClick={() => setStep(0)}>Back</button>
    </div>,

    // Step 2 — Choose phase
    <div key={2} style={{ padding: '0 24px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Starting Phase</div>
      <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>You can change this anytime in Settings.</div>
      {PHASES.map(p => (
        <div key={p.id} onClick={() => set('phase', p.id)} style={{
          background: form.phase === p.id ? p.color + '18' : C.surface,
          border: `1px solid ${form.phase === p.id ? p.color : C.border}`,
          borderRadius: 14, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', transition: 'all 0.2s'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, color: form.phase === p.id ? p.color : C.text }}>{p.label}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{p.desc} · {p.weeks} weeks</div>
            </div>
            {form.phase === p.id && <span style={{ color: p.color, fontSize: 20 }}>✓</span>}
          </div>
        </div>
      ))}
      <button className="btn-primary" onClick={() => setStep(3)}>Next →</button>
      <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
    </div>,

    // Step 3 — Activity prefs
    <div key={3} style={{ padding: '0 24px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Activity Preferences</div>
      <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>How often do you want these built into your weekly plan?</div>
      {[
        { label: '🏊 Swim sessions/week', key: 'swim_per_week', min: 0, max: 4 },
        { label: '🏀 Basketball sessions/week', key: 'basketball_per_week', min: 0, max: 3 },
        { label: '🥊 Kickboxing sessions/week', key: 'kickboxing_per_week', min: 0, max: 5 },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <label className="label">{f.label}</label>
            <span style={{ fontSize: 14, color: C.accent, fontWeight: 700 }}>{form.preferences[f.key]}x</span>
          </div>
          <input type="range" min={f.min} max={f.max} value={form.preferences[f.key]}
            style={{ width: '100%', accentColor: C.accent }}
            onChange={e => set('preferences', { ...form.preferences, [f.key]: parseInt(e.target.value) })} />
        </div>
      ))}
      <div style={{ marginBottom: 20 }}>
        <label className="label">Sleep target (hours)</label>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: C.muted }}>Target</span>
          <span style={{ fontSize: 14, color: C.orange, fontWeight: 700 }}>{form.preferences.sleep_target}h</span>
        </div>
        <input type="range" min={6} max={9} step={0.5} value={form.preferences.sleep_target}
          style={{ width: '100%', accentColor: C.orange }}
          onChange={e => set('preferences', { ...form.preferences, sleep_target: parseFloat(e.target.value) })} />
      </div>
      <button className="btn-primary" disabled={saving} onClick={finish}>
        {saving ? 'Setting up...' : 'Start Training ⚡'}
      </button>
      <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
    </div>,
  ]

  return (
    <div className="screen" style={{ paddingBottom: 40 }}>
      <div style={{ paddingTop: 60 }}>
        {steps[step]}
      </div>
    </div>
  )
}
