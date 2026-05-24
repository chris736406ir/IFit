import { useState, useEffect } from 'react'
import { C, getWeekStart, DAYS_FULL, PHASES, getPhaseWeek } from '../lib/constants.js'
import { ATHLETE_PROFILE } from '../lib/constants.js'
import { getMealPlan, saveMealPlan, getWeekPlan } from '../lib/supabase.js'
import { callAIJSON } from '../lib/ai.js'

function buildMealPrompt(profile, weekStart, weekPlan) {
  const phase = PHASES.find(p => p.id === profile.phase) || PHASES[0]
  const system = `You are a personal nutrition AI coach. Athlete profile:\n${ATHLETE_PROFILE}\nCurrent weight: ${profile.weight_lbs}lbs. Phase: ${phase.label}.\nRespond ONLY with valid JSON starting with { and ending with }.`

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }

  const trainingDays = weekPlan ? Object.entries(weekPlan.days || {}).filter(([, v]) => v.day_type === 'training').map(([k]) => k) : days.slice(0, 5)
  const recoveryDays = days.filter(d => !trainingDays.includes(d))

  const user = `Generate a complete weekly meal plan for the week starting ${weekStart}.

Training days (higher carbs/calories): ${trainingDays.join(', ')}
Recovery days (slightly lower calories): ${recoveryDays.join(', ')}

Rules:
- High protein every day (~200g)
- Training days: ~2600 cal | Recovery days: ~2200 cal
- Use preferred foods: beef, eggs, sausage, chicken, Oikos Greek yogurt
- Include healthy late-night snack every day (munchies prevention)
- Practical meals — not complicated recipes
- Vary meals day-to-day so it doesn't get boring
- Post-workout meals should be high protein + carbs
- Pre-workout meals should be light and energizing

Return JSON:
{
  "week_start": "${weekStart}",
  "weekly_protein_avg": 200,
  "weekly_cal_avg": 2400,
  "days": {
    "${days[0]}": {
      "day_type": "training|recovery",
      "calories": 2600,
      "protein_g": 205,
      "meals": [
        {"name": "Post-Morning Workout", "time": "~7am", "foods": ["2 eggs scrambled", "3 strips turkey sausage", "1 cup Greek yogurt"], "protein_g": 45, "cal": 400, "notes": ""},
        {"name": "Lunch", "time": "12pm", "foods": [], "protein_g": 50, "cal": 550},
        {"name": "Pre-Workout Snack", "time": "1:30pm", "foods": [], "protein_g": 25, "cal": 250},
        {"name": "Post-Workout Dinner", "time": "5pm", "foods": [], "protein_g": 55, "cal": 700},
        {"name": "Late Night Snack", "time": "9-10pm", "foods": [], "protein_g": 25, "cal": 200, "notes": "healthy munchies option"}
      ]
    }
    ${days.slice(1).map(d => `,"${d}": { same structure }`).join('\n')}
  },
  "grocery_list": {
    "proteins": ["2 lbs ground beef", "12 eggs", "2 lbs chicken breast"],
    "dairy": ["6 Oikos Greek yogurt cups"],
    "produce": ["spinach", "bananas", "sweet potatoes"],
    "pantry": ["oats", "rice", "olive oil"],
    "snacks": ["rice cakes", "string cheese", "cottage cheese"]
  }
}`

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
  const [checkedItems, setCheckedItems] = useState({})

  useEffect(() => {
    loadPlans()
  }, [])

  async function loadPlans() {
    const [meal, week] = await Promise.all([getMealPlan(weekStart), getWeekPlan(weekStart)])
    setMealPlan(meal)
    setWeekPlan(week)
  }

  async function generateMealPlan() {
    setGenerating(true)
    setError(null)
    try {
      const { system, user } = buildMealPrompt(profile, weekStart, weekPlan)
      const data = await callAIJSON(system, user, 5000)
      await saveMealPlan(weekStart, data.days, data.grocery_list)
      setMealPlan({ days: data.days, grocery_list: data.grocery_list, weekly_protein_avg: data.weekly_protein_avg, weekly_cal_avg: data.weekly_cal_avg })
    } catch (e) {
      setError(e.message)
    }
    setGenerating(false)
  }

  function toggleItem(category, item) {
    const key = `${category}-${item}`
    setCheckedItems(c => ({ ...c, [key]: !c[key] }))
  }

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }

  const dayData = mealPlan?.days?.[selectedDay]

  return (
    <div className="screen">
      <div className="header">
        <div style={{ fontWeight: 800, fontSize: 17 }}>🥗 Meal Plan</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {mealPlan && <span style={{ color: C.green, marginLeft: 8 }}>· ~{mealPlan.weekly_cal_avg} cal · {mealPlan.weekly_protein_avg}g protein/day</span>}
        </div>
      </div>

      <div style={{ paddingTop: 16 }}>
        {!mealPlan && !generating && (
          <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🍳</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No Meal Plan Yet</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>AI will generate your full week of meals and a grocery list based on your training schedule.</div>
            <button className="btn-primary" onClick={generateMealPlan} style={{ width: 'auto', padding: '12px 28px', marginBottom: 0 }}>Generate Meal Plan ⚡</button>
          </div>
        )}

        {generating && (
          <div className="card" style={{ textAlign: 'center', padding: '24px 18px' }}>
            <div style={{ fontSize: 24, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 13, color: C.muted }}>Building your weekly meal plan and grocery list...</div>
          </div>
        )}

        {error && (
          <div className="card" style={{ background: C.redSoft, border: `1px solid ${C.red}44` }}>
            <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>⚠️ {error}</div>
            <button className="btn-primary" onClick={generateMealPlan}>Retry</button>
          </div>
        )}

        {mealPlan && (
          <>
            {/* Day selector */}
            <div style={{ display: 'flex', overflowX: 'auto', gap: 8, padding: '0 16px 12px', scrollbarWidth: 'none' }}>
              {days.map((date, i) => {
                const isSelected = date === selectedDay
                const isToday = date === new Date().toISOString().split('T')[0]
                const dayMeals = mealPlan.days?.[date]
                return (
                  <button key={date} onClick={() => setSelectedDay(date)} style={{
                    flexShrink: 0, background: isSelected ? C.accent : C.surface,
                    border: `1px solid ${isToday && !isSelected ? C.accent : isSelected ? C.accent : C.border}`,
                    borderRadius: 12, padding: '8px 14px', cursor: 'pointer', transition: 'all 0.15s'
                  }}>
                    <div style={{ fontSize: 11, color: isSelected ? '#fff' : C.muted }}>{DAYS_FULL[i].slice(0, 3)}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#fff' : C.text }}>
                      {new Date(date + 'T12:00:00').getDate()}
                    </div>
                    {dayMeals && <div style={{ width: 4, height: 4, borderRadius: '50%', background: isSelected ? '#fff' : C.green, margin: '3px auto 0' }} />}
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
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {dayData.calories} cal · {dayData.protein_g}g protein
                  </div>
                </div>
                {dayData.meals?.map((meal, i) => (
                  <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < dayData.meals.length - 1 ? `1px solid ${C.surfaceAlt}` : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: C.green }}>{meal.name}</div>
                      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>
                        {meal.time && <div>{meal.time}</div>}
                        <div>{meal.protein_g}g protein · {meal.cal} cal</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.6 }}>{meal.foods?.join(', ')}</div>
                    {meal.notes && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, fontStyle: 'italic' }}>{meal.notes}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="card" style={{ textAlign: 'center', color: C.muted, padding: '24px' }}>No meal data for this day.</div>
            )}

            {/* Grocery List */}
            {mealPlan.grocery_list && (
              <div className="card">
                <div onClick={() => setGroceryOpen(!groceryOpen)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: groceryOpen ? 16 : 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>🛒 Grocery List</div>
                  <span style={{ color: C.muted, fontSize: 18 }}>{groceryOpen ? '↑' : '↓'}</span>
                </div>
                {groceryOpen && Object.entries(mealPlan.grocery_list).map(([category, items]) => (
                  <div key={category} style={{ marginBottom: 16 }}>
                    <div className="section-title" style={{ textTransform: 'capitalize' }}>{category}</div>
                    {items.map((item, i) => {
                      const key = `${category}-${item}`
                      const checked = checkedItems[key]
                      return (
                        <div key={i} onClick={() => toggleItem(category, item)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', cursor: 'pointer', borderBottom: `1px solid ${C.surfaceAlt}` }}>
                          <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${checked ? C.green : C.subtle}`, background: checked ? C.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
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
              <button className="btn-secondary" onClick={generateMealPlan} disabled={generating} style={{ fontSize: 13 }}>↺ Regenerate Meal Plan</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
