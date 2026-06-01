import { useState, useEffect } from 'react'
import { C, getWeekStart, DAYS_FULL, PHASES, ATHLETE_PROFILE } from '../lib/constants.js'
import { getMealPlan, saveMealPlan, getWeekPlan } from '../lib/supabase.js'
import { callAI, repairAndParseJSON } from '../lib/ai.js'

const MEAL_SCHEMA = `Each day uses this structure. Foods are plain strings, not nested objects.
{
  "day_type": "training",
  "calories": 2600,
  "protein_g": 205,
  "meals": [
    {"name": "Post-Morning Workout", "time": "7am", "foods": "3 eggs, 2 turkey sausage, Greek yogurt", "protein_g": 50, "cal": 420},
    {"name": "Lunch", "time": "12pm", "foods": "ground beef rice bowl, cottage cheese side", "protein_g": 55, "cal": 600},
    {"name": "Pre-Workout", "time": "1:30pm", "foods": "banana, string cheese", "protein_g": 10, "cal": 200},
    {"name": "Post-Workout Dinner", "time": "5:30pm", "foods": "grilled chicken, sweet potato, spinach", "protein_g": 55, "cal": 650},
    {"name": "Late Night Snack", "time": "9pm", "foods": "Greek yogurt with berries, rice cakes", "protein_g": 25, "cal": 220, "notes": "healthy munchies — stop here"}
  ]
}
Keep foods simple strings. 1-4 items comma separated. No recipes. Vary across the 7 days.`

function buildMealPrompt(profile, weekStart, weekPlan) {
  const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
  const prefs = profile.preferences || {}

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    days.push({ date: d.toISOString().split('T')[0], name: DAYS_FULL[d.getDay()] })
  }

  const trainingDates = weekPlan
    ? days.filter(d => weekPlan.days?.[d.date]?.day_type === 'training').map(d => d.date)
    : days.slice(1, 6).map(d => d.date)
  const recoveryDates = days.map(d => d.date).filter(d => !trainingDates.includes(d))

  const system = 'You are a personal AI trainer AND nutritionist. ' + ATHLETE_PROFILE +
    '\nCurrent weight: ' + profile.weight_lbs + 'lbs | Phase: ' + phase.label +
    '\n\n' + MEAL_SCHEMA +
    '\n\nRESPOND ONLY WITH VALID JSON. Start with { end with }. No markdown.'

  const user = 'Generate a 7-day meal plan for week starting ' + weekStart + '.\n\n' +
    'Training days (2600cal/205g protein): ' + (trainingDates.join(', ') || 'Mon-Fri') + '\n' +
    'Recovery days (2200cal/185g protein): ' + (recoveryDates.join(', ') || 'Sat-Sun') + '\n\n' +
    'Rules: preferred foods beef/eggs/sausage/chicken/Greek yogurt. High protein daily. Vary meals across 7 days.\n\n' +
    'Also generate a supplement_stack section (generate once, not per day) with natural testosterone optimization, recovery, and performance supplements.\n\n' +
    'Return:\n' +
    '{\n' +
    '  "week_start": "' + weekStart + '",\n' +
    '  "weekly_protein_avg": 200,\n' +
    '  "weekly_cal_avg": 2400,\n' +
    '  "days": {\n' +
    '    "' + days[0].date + '": {day structure},\n' +
    '    "' + days[1].date + '": {day structure},\n' +
    '    "' + days[2].date + '": {day structure},\n' +
    '    "' + days[3].date + '": {day structure},\n' +
    '    "' + days[4].date + '": {day structure},\n' +
    '    "' + days[5].date + '": {day structure},\n' +
    '    "' + days[6].date + '": {day structure}\n' +
    '  },\n' +
    '  "grocery_list": {\n' +
    '    "proteins": [],\n' +
    '    "dairy": [],\n' +
    '    "produce": [],\n' +
    '    "pantry": [],\n' +
    '    "snacks": []\n' +
    '  },\n' +
    '  "supplement_stack": {\n' +
    '    "daily_foundation": ["Vitamin D3 5000IU + K2", "Zinc 30mg with food", "Magnesium glycinate 400mg before bed"],\n' +
    '    "performance": ["Creatine monohydrate 5g daily"],\n' +
    '    "hormone_optimization": ["Ashwagandha 600mg", "other evidence-based options"],\n' +
    '    "pre_workout": ["optional options"],\n' +
    '    "post_workout": ["whey if needed"],\n' +
    '    "before_bed": ["sleep optimization options"],\n' +
    '    "notes": "timing and usage guidance"\n' +
    '  }\n' +
    '}'

  return { system, user }
}

export default function MealScreen({ profile }) {
  const weekStart = getWeekStart()
  const [mealPlan, setMealPlan] = useState(null)
  const [weekPlan, setWeekPlan] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [selectedDay, setSelectedDay] = useState(new Date().toISOString().split('T')[0])
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [supplementOpen, setSupplementOpen] = useState(false)
  const [checkedItems, setCheckedItems] = useState({})

  useEffect(() => { loadPlans() }, [])

  async function loadPlans() {
    const [meal, week] = await Promise.all([getMealPlan(weekStart), getWeekPlan(weekStart)])
    if (meal) setMealPlan(meal)
    if (week) setWeekPlan(week)
  }

  async function generateMealPlan() {
    setGenerating(true)
    setError(null)
    try {
      const { system, user } = buildMealPrompt(profile, weekStart, weekPlan)
      const raw = await callAI(system, user, 6000)
      const data = repairAndParseJSON(raw)
      await saveMealPlan(weekStart, data.days, data.grocery_list)
      // Preserve existing meal plan if generation partially fails
      setMealPlan(prev => ({
        days: data.days || prev?.days,
        grocery_list: data.grocery_list || prev?.grocery_list,
        supplement_stack: data.supplement_stack || prev?.supplement_stack,
        weekly_protein_avg: data.weekly_protein_avg || prev?.weekly_protein_avg,
        weekly_cal_avg: data.weekly_cal_avg || prev?.weekly_cal_avg,
      }))
    } catch (e) {
      setError(e.message)
      // Don't wipe existing plan on failure
    }
    setGenerating(false)
  }

  function toggleItem(category, item) {
    const key = category + '-' + item
    setCheckedItems(c => ({ ...c, [key]: !c[key] }))
  }

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }

  const dayData = mealPlan?.days?.[selectedDay]
  const today = new Date().toISOString().split('T')[0]
  const supps = mealPlan?.supplement_stack

  return (
    <div className="screen">
      <div className="header">
        <div style={{ fontWeight: 800, fontSize: 17 }}>🥗 Nutrition</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {mealPlan && <span style={{ color: C.green, marginLeft: 8 }}>· ~{mealPlan.weekly_cal_avg} cal · {mealPlan.weekly_protein_avg}g protein/day</span>}
        </div>
      </div>

      <div style={{ paddingTop: 16 }}>
        {!mealPlan && !generating && (
          <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🍳</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No Nutrition Plan Yet</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
              Generates your weekly meal plan, grocery list, and full supplement stack optimized for your goals.
            </div>
            <button className="btn-primary" onClick={generateMealPlan} style={{ width: 'auto', padding: '12px 28px', marginBottom: 0 }}>
              Generate Nutrition Plan ⚡
            </button>
          </div>
        )}

        {generating && (
          <div className="card" style={{ textAlign: 'center', padding: '24px 18px' }}>
            <div style={{ fontSize: 24, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 13, color: C.muted }}>Building your meal plan, grocery list, and supplement stack...</div>
          </div>
        )}

        {error && (
          <div className="card" style={{ background: C.redSoft, border: '1px solid ' + C.red + '44' }}>
            <div style={{ fontSize: 13, color: C.red, marginBottom: 6 }}>⚠️ {error}</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
              {mealPlan ? 'Your existing plan is intact.' : 'Tap retry to try again.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={generateMealPlan} style={{ margin: 0, flex: 1 }}>Retry</button>
              <button className="btn-secondary" onClick={() => setError(null)} style={{ margin: 0, flex: 1 }}>Dismiss</button>
            </div>
          </div>
        )}

        {mealPlan && (
          <>
            {/* Supplement stack — always shown at top */}
            {supps && (
              <div className="card" style={{ background: 'rgba(255,159,67,0.08)', border: '1px solid ' + C.orange + '33' }}>
                <div onClick={() => setSupplementOpen(!supplementOpen)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: supplementOpen ? 14 : 0 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>💊 Supplement Stack</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Optimized for recomp + testosterone + recovery</div>
                  </div>
                  <span style={{ color: C.muted }}>{supplementOpen ? '↑' : '↓'}</span>
                </div>

                {supplementOpen && (
                  <div>
                    {[
                      { key: 'daily_foundation', label: '🏗️ Daily Foundation', color: C.accent },
                      { key: 'performance', label: '⚡ Performance', color: C.green },
                      { key: 'hormone_optimization', label: '🔥 Hormone Optimization', color: C.orange },
                      { key: 'pre_workout', label: '🏋️ Pre-Workout', color: C.yellow },
                      { key: 'post_workout', label: '🔄 Post-Workout', color: C.green },
                      { key: 'before_bed', label: '😴 Before Bed', color: C.muted },
                    ].map(({ key, label, color }) => supps[key]?.length > 0 && (
                      <div key={key} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
                        {supps[key].map((item, i) => (
                          <div key={i} style={{ fontSize: 13, color: '#bbb', marginBottom: 4 }}>• {item}</div>
                        ))}
                      </div>
                    ))}
                    {supps.notes && (
                      <div style={{ fontSize: 12, color: C.muted, background: C.surfaceAlt, borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>
                        📋 {supps.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Day selector */}
            <div style={{ display: 'flex', overflowX: 'auto', gap: 8, padding: '0 16px 12px', scrollbarWidth: 'none' }}>
              {days.map((date, i) => {
                const isSelected = date === selectedDay
                const isToday = date === today
                const hasMeals = !!mealPlan.days?.[date]
                return (
                  <button key={date} onClick={() => setSelectedDay(date)} style={{
                    flexShrink: 0, background: isSelected ? C.accent : C.surface,
                    border: '1px solid ' + (isToday && !isSelected ? C.accent : isSelected ? C.accent : C.border),
                    borderRadius: 12, padding: '8px 14px', cursor: 'pointer', transition: 'all 0.15s'
                  }}>
                    <div style={{ fontSize: 11, color: isSelected ? '#fff' : C.muted }}>{DAYS_FULL[i].slice(0, 3)}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#fff' : C.text }}>
                      {new Date(date + 'T12:00:00').getDate()}
                    </div>
                    {hasMeals && <div style={{ width: 4, height: 4, borderRadius: '50%', background: isSelected ? '#fff' : C.green, margin: '3px auto 0' }} />}
                  </button>
                )
              })}
            </div>

            {/* Day meals */}
            {dayData ? (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                    <span style={{ fontSize: 11, color: dayData.day_type === 'training' ? C.accent : C.green, marginLeft: 8, fontWeight: 400 }}>
                      {dayData.day_type === 'training' ? 'Training day' : 'Recovery day'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, textAlign: 'right' }}>
                    <div>{dayData.calories} cal</div>
                    <div>{dayData.protein_g}g protein</div>
                  </div>
                </div>

                {dayData.meals?.map((meal, i) => (
                  <div key={i} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < dayData.meals.length - 1 ? '1px solid ' + C.surfaceAlt : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: C.green }}>{meal.name}</div>
                      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                        {meal.time && <div>{meal.time}</div>}
                        <div>{meal.protein_g}g · {meal.cal} cal</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.6 }}>
                      {typeof meal.foods === 'string' ? meal.foods : meal.foods?.join(' · ')}
                    </div>
                    {meal.notes && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, fontStyle: 'italic' }}>{meal.notes}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="card" style={{ textAlign: 'center', color: C.muted, padding: 24 }}>No meal data for this day.</div>
            )}

            {/* Grocery List */}
            {mealPlan.grocery_list && (
              <div className="card">
                <div onClick={() => setGroceryOpen(!groceryOpen)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: groceryOpen ? 16 : 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>🛒 Grocery List</div>
                  <span style={{ color: C.muted }}>{groceryOpen ? '↑' : '↓'}</span>
                </div>

                {groceryOpen && Object.entries(mealPlan.grocery_list).map(([category, items]) => (
                  <div key={category} style={{ marginBottom: 16 }}>
                    <div className="section-title" style={{ textTransform: 'capitalize' }}>{category}</div>
                    {Array.isArray(items) && items.map((item, i) => {
                      const key = category + '-' + item
                      const checked = checkedItems[key]
                      return (
                        <div key={i} onClick={() => toggleItem(category, item)} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer',
                          borderBottom: '1px solid ' + C.surfaceAlt
                        }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                            border: '2px solid ' + (checked ? C.green : C.subtle),
                            background: checked ? C.green : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s'
                          }}>
                            {checked && <span style={{ fontSize: 12, color: '#fff', fontWeight: 700 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 14, color: checked ? C.muted : C.text, textDecoration: checked ? 'line-through' : 'none' }}>{item}</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            <div style={{ padding: '4px 16px' }}>
              <button className="btn-secondary" onClick={generateMealPlan} disabled={generating} style={{ fontSize: 13 }}>
                ↺ Regenerate Nutrition Plan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
