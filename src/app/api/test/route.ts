import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY

  if (!key) {
    return NextResponse.json({ 
      status: 'error', 
      issue: 'ANTHROPIC_API_KEY environment variable is not set',
      fix: 'Go to Vercel → Project Settings → Environment Variables and add ANTHROPIC_API_KEY'
    })
  }

  // Test the simplest possible API call
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say: API working' }],
      }),
    })

    const body = await r.json()

    if (!r.ok) {
      return NextResponse.json({
        status: 'error',
        http_status: r.status,
        error: body,
        key_prefix: key.slice(0, 20) + '...',
        fix: r.status === 401 ? 'API key is invalid or expired' :
             r.status === 400 ? 'Bad request — model string may be wrong' :
             r.status === 429 ? 'Rate limited — too many requests' :
             'See error details above'
      })
    }

    const text = body.content?.[0]?.text || 'No text in response'

    return NextResponse.json({
      status: 'ok',
      model: 'claude-haiku-4-5-20251001',
      response: text,
      key_prefix: key.slice(0, 20) + '...',
      message: 'API is working correctly. The pipeline should work.'
    })

  } catch (e) {
    return NextResponse.json({
      status: 'error',
      issue: 'Network error reaching Anthropic API',
      detail: e instanceof Error ? e.message : String(e),
      fix: 'Check Vercel function logs for more detail'
    })
  }
}
