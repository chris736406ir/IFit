export async function callAI(system, user, tokens = 8000) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, user, tokens }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'API error ' + res.status)
  if (!data.text) throw new Error('Empty response from AI')
  return data.text
}

export function repairAndParseJSON(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object found in response')
  let s = raw.slice(start, end + 1)
  try { return JSON.parse(s) } catch (e1) {
    s = s.replace(/,(\s*[}\]])/g, '$1')
    try { return JSON.parse(s) } catch {
      throw new Error('Parse failed: ' + e1.message)
    }
  }
}
