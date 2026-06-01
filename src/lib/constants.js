export const ATHLETE_PROFILE = `
ATHLETE PROFILE:
- Age: 26 | Height: 6'4" | Weight: ~220lbs
- Goal: Body recomp — reduce torso/chest fat, build arms/legs/shoulders. Feel athletic, functional, and confident.
- Experience: ~9 years lifting, intermediate, returning from 2-month break.
- Athletic background: former competitive swimmer, intermediate kickboxer, loves basketball.

HOME GYM (Morning — fasted ~6am, 20-45min):
- Full cable machine, flat bench, pullup bar, jump rope, heavy kickboxing bag
- Purpose: mobility, activation, accessory, kickboxing — NOT heavy lifting

COMMERCIAL GYM (Afternoon ~2-3pm, 90min):
- Full free weights, machines, cables, lap pool, basketball court

WEEKLY ACTIVITY DISTRIBUTION:
- Swim: 1-2x/week | Basketball: 1x/week | Kickboxing bag: 2-3x/week morning | Running/jump rope: recovery days

INJURIES (always respect):
- Left pec: NO heavy cable flyes. ALWAYS dumbbell incline over flat bench.
- Lower back: warm up spine carefully, no reckless loading
- Knees: ATG/KneesOverToes approach — deep ROM, step-downs, tibialis work
- Hips: very tight — hip mobility in EVERY morning session

TRAINING RULES:
- Hip mobility every single morning
- Core work minimum 3x/week
- ATG-style squats/lunges for knee health
- Dumbbell incline instead of flat bench
- Protect lower back on all hinge movements
- Progressive overload week over week on main lifts
- Sunday = active recovery only

NUTRITION ROLE — act as both personal trainer AND nutritionist:
- Prioritize natural testosterone optimization through food, lifestyle, and supplements
- Focus on recovery nutrition, sleep quality, and hormonal health
- Whole food first, supplements fill gaps
- High protein ~200g/day, ~2400-2600 cal (training days), ~2200 cal (recovery days)
- Preferred foods: beef, eggs, sausage, chicken, Oikos Greek yogurt
- Healthy late-night snack options (tendency for munchies)
`

export const PHASES = [
  { id: 'athletic_hypertrophy', label: 'Athletic Hypertrophy', color: '#6c5fff', desc: 'Build muscle + athleticism, recomp', weeks: 6 },
  { id: 'stamina', label: 'Stamina & Conditioning', color: '#ff6b6b', desc: 'Cardio capacity, endurance, lower body', weeks: 4 },
  { id: 'strength', label: 'Strength Block', color: '#ffd93d', desc: 'Progressive overload, compound focus', weeks: 4 },
  { id: 'recovery', label: 'Active Recovery', color: '#00d68f', desc: 'Deload week, mobility & joint health', weeks: 2 },
]

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const C = {
  bg: '#08080f',
  surface: '#11111c',
  surfaceAlt: '#171724',
  border: '#1e1e30',
  subtle: '#2a2a40',
  accent: '#6c5fff',
  accentSoft: 'rgba(108,95,255,0.12)',
  orange: '#ff9f43',
  orangeSoft: 'rgba(255,159,67,0.12)',
  green: '#00d68f',
  greenSoft: 'rgba(0,214,143,0.12)',
  red: '#ff6b6b',
  redSoft: 'rgba(255,107,107,0.12)',
  yellow: '#ffd93d',
  yellowSoft: 'rgba(255,217,61,0.12)',
  text: '#eeeeff',
  muted: '#6666aa',
}

export function getWeekStart(date = new Date()) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split('T')[0]
}

export function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function getPhaseWeek(phaseStart) {
  return Math.max(1, Math.ceil((Date.now() - new Date(phaseStart)) / (7 * 86400000)))
}
