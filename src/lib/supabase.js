import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, key)

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile() {
  const { data } = await supabase.from('profile').select('*').eq('id', 1).single()
  return data
}

export async function saveProfile(profile) {
  const { data, error } = await supabase.from('profile').upsert({ id: 1, ...profile, updated_at: new Date().toISOString() })
  if (error) throw error
  return data
}

// ─── Weekly Plans ─────────────────────────────────────────────────────────────

export async function getWeekPlan(weekStart) {
  const { data } = await supabase.from('weekly_plans').select('*').eq('week_start', weekStart).single()
  return data
}

export async function saveWeekPlan(weekStart, days, phase, phaseWeek) {
  const { data, error } = await supabase.from('weekly_plans').upsert({
    week_start: weekStart, days, phase, phase_week: phaseWeek, updated_at: new Date().toISOString()
  }, { onConflict: 'week_start' })
  if (error) throw error
  return data
}

export async function getRecentWeekPlans(limit = 4) {
  const { data } = await supabase.from('weekly_plans').select('*').order('week_start', { ascending: false }).limit(limit)
  return data || []
}

// ─── Daily Logs ───────────────────────────────────────────────────────────────

export async function getLog(date) {
  const { data } = await supabase.from('daily_logs').select('*').eq('date', date).single()
  return data
}

export async function saveLog(log) {
  const { data, error } = await supabase.from('daily_logs').upsert({
    ...log, updated_at: new Date().toISOString()
  }, { onConflict: 'date' })
  if (error) throw error
  return data
}

export async function getRecentLogs(days = 30) {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data } = await supabase.from('daily_logs').select('*')
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: false })
  return data || []
}

export async function getLogsForWeek(weekStart) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const { data } = await supabase.from('daily_logs').select('*')
    .gte('date', weekStart)
    .lte('date', weekEnd.toISOString().split('T')[0])
  return data || []
}

// ─── Meal Plans ───────────────────────────────────────────────────────────────

export async function getMealPlan(weekStart) {
  const { data } = await supabase.from('meal_plans').select('*').eq('week_start', weekStart).single()
  return data
}

export async function saveMealPlan(weekStart, days, groceryList) {
  const { data, error } = await supabase.from('meal_plans').upsert({
    week_start: weekStart, days, grocery_list: groceryList
  }, { onConflict: 'week_start' })
  if (error) throw error
  return data
}
