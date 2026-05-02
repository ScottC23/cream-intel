import { NextRequest, NextResponse } from 'next/server'
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, max_tokens = 2000, model = 'claude-sonnet-4-20250514', system } = body
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    const payload: Record<string, unknown> = { model, max_tokens, messages }
    if (system) payload.system = system
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) return NextResponse.json(await r.json().catch(() => ({})), { status: r.status })
    return NextResponse.json(await r.json())
  } catch (e) { console.error(e); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
