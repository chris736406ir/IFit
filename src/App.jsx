import { useState, useEffect } from 'react'
import { getProfile } from './lib/supabase.js'
import { C } from './lib/constants.js'
import Onboarding from './screens/Onboarding.jsx'
import WeekScreen from './screens/WeekScreen.jsx'
import MealScreen from './screens/MealScreen.jsx'
import ProgressScreen from './screens/ProgressScreen.jsx'
import SettingsScreen from './screens/SettingsScreen.jsx'

const tabs = [
  { id: 'week', icon: '⚡', label: 'Week' },
  { id: 'meals', icon: '🥗', label: 'Meals' },
  { id: 'progress', icon: '📊', label: 'Progress' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
]

function Splash() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', background: 'radial-gradient(ellipse at 50% 38%, #1c0d40 0%, #0d0820 45%, #08080f 100%)',
      position: 'relative', overflow: 'hidden'
    }}>
      {[420, 300, 200, 120].map((size, i) => (
        <div key={i} style={{
          position: 'absolute', width: size, height: size, borderRadius: '50%',
          border: `1px solid rgba(108,95,255,${0.05 + i * 0.06})`,
          top: '50%', left: '50%', transform: 'translate(-50%, -58%)',
        }} />
      ))}
      <div style={{ position: 'absolute', top: 40, right: 40, width: 60, height: 60, borderTop: '1px solid #6c5fff44', borderRight: '1px solid #6c5fff44' }} />
      <div style={{ position: 'absolute', bottom: 120, left: 40, width: 60, height: 60, borderBottom: '1px solid #6c5fff44', borderLeft: '1px solid #6c5fff44' }} />
      <div style={{ fontSize: 72, lineHeight: 1, marginBottom: 24, zIndex: 1, filter: 'drop-shadow(0 0 24px #8b7fff) drop-shadow(0 0 60px #6c5fff88)' }}>⚡</div>
      <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: 10, textTransform: 'uppercase', zIndex: 1, background: 'linear-gradient(135deg, #ffffff 0%, #c4b5ff 50%, #8b7fff 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 10 }}>IFit</div>
      <div style={{ fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', zIndex: 1, color: '#5555aa', marginBottom: 48 }}>AI Training System</div>
      <div style={{ width: 120, height: 2, background: '#1e1e30', borderRadius: 2, overflow: 'hidden', zIndex: 1 }}>
        <div style={{ width: '60%', height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #6c5fff, #a78bfa)', boxShadow: '0 0 8px #6c5fff' }} />
      </div>
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState('week')
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getProfile().then(p => {
      setProfile(p)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <Splash />
  if (!profile?.onboarded) return <Onboarding onComplete={() => getProfile().then(setProfile)} />

  return (
    <div>
      {screen === 'week' && <WeekScreen profile={profile} />}
      {screen === 'meals' && <MealScreen profile={profile} />}
      {screen === 'progress' && <ProgressScreen profile={profile} />}
      {screen === 'settings' && <SettingsScreen profile={profile} onProfileUpdate={setProfile} />}

      <nav className="nav">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setScreen(tab.id)} className={`nav-btn${screen === tab.id ? ' active' : ''}`}>
            <span style={{ fontSize: 22 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
