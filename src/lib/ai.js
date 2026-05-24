export async function callAI(system, user, tokens = 4000) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, user, tokens }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'API error')
  if (!data.text) throw new Error('Empty response from AI')
  return data.text
}

export function parseJSON(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON found in response')
  return JSON.parse(raw.slice(start, end + 1))
}

export async function callAIJSON(system, user, tokens = 4000) {
  const raw = await callAI(system, user, tokens)
  return parseJSON(raw)
}
