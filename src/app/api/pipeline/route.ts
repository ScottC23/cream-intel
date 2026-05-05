import { NextRequest, NextResponse } from 'next/server'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function claude(prompt: string, maxTokens: number): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(attempt * 8000)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (res.status === 429 || res.status === 529) {
      console.warn(`Status ${res.status}, attempt ${attempt + 1}, waiting...`)
      await sleep(15000)
      continue
    }

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`API ${res.status}: ${body.slice(0, 200)}`)
    }

    const data = await res.json()
    return data.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')
  }
  throw new Error('Max retries exceeded')
}

function parseJSON<T>(txt: string): T {
  const clean = txt.replace(/```json\n?|\n?```/g, '').trim()
  try { return JSON.parse(clean) as T }
  catch {
    const m = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (m) return JSON.parse(m[0]) as T
    throw new Error('JSON parse failed: ' + clean.slice(0, 200))
  }
}

export async function POST(req: NextRequest) {
  try {
    const { company, themes } = await req.json()
    const { value, type, url } = company as { value: string; type: string; url?: string }

    const themeDesc: Record<string, string> = {
      data: 'data infrastructure, platforms, data engineering, analytics, data lakes',
      ai: 'AI strategy, machine learning, generative AI, LLMs, AI-driven products',
      automation: 'RPA, manufacturing automation, robots, workflow automation',
      tom: 'restructuring, digital transformation, operating model redesign, new leadership',
      cyber: 'cybersecurity investment, zero trust, CISO appointment, security transformation',
      cost: 'cost reduction, opex reduction, efficiency programmes, margin improvement',
      ops: 'operational excellence, process improvement, supply chain, ERP, digital operations',
    }
    const themeList = (themes as string[]).map(t => `${t}: ${themeDesc[t] || t}`).join('\n')

    // ── Step 1: Resolve ───────────────────────────────────────────
    const resolvePrompt = `You are a US company intelligence specialist. Resolve this company and return ONLY a JSON object.

Company: "${value}" (${type})${url ? `\nWebsite: ${url} — use as primary anchor` : ''}

JSON fields:
- name: official company name
- track: "public" | "private" | "hybrid"  
- stage: "public" | "series-b" | "series-a" | "seed" | "private" | "pe"
- cik: SEC CIK number with leading zeros, or null
- ticker: exchange ticker or null
- exchange: "NYSE" | "NASDAQ" | null
- sic: 4-digit SIC code or null
- sicDesc: SIC description or null
- hq: "City, State" or null
- employees: approximate e.g. "~5,000" or null
- sector: primary sector description
- website: canonical domain or null
- formDFiled: true | false | null
- formDAmount: most recent raise e.g. "$50m" or null
- investors: lead investors or null
- dataQuality: 0-100 integer
- partial: false
- resolutionNote: 2-3 sentences describing the company and any data quality notes

dataQuality guide: 90+=major public company or large PE-backed with rich press coverage. 70-89=public with gaps or large PE company. 50-69=private with decent coverage. 30-49=limited signal. <30=very limited.
PE-backed companies (KKR, Blackstone etc.) can score 70-90 even if not listed.

Return ONLY the JSON object, no other text.`

    const resolvedTxt = await claude(resolvePrompt, 600)
    const resolved = parseJSON<Record<string, unknown>>(resolvedTxt)

    await sleep(1000)

    // ── Step 2: Extract signals ────────────────────────────────────
    const stage = (resolved.stage as string) || 'private'
    const sector = (resolved.sector as string) || 'Unknown'
    const coName = (resolved.name as string) || value

    const extractPrompt = `You are a senior intelligence analyst. Extract signals about ${coName}.

Company: ${coName} | Track: ${resolved.track} | Stage: ${stage} | Sector: ${sector}
${resolved.cik ? `CIK: ${resolved.cik}` : ''}${resolved.ticker ? ` | Ticker: ${resolved.ticker}` : ''}
${url ? `Website: ${url}` : ''}
Today: ${new Date().toISOString().slice(0, 10)}

Signal themes to extract:
${themeList}

Use your knowledge of this company from SEC filings, earnings calls, press releases, job postings, investor announcements, leadership changes, and strategic statements.

Return ONLY a JSON array of signal objects:
[{
  "theme": "data|ai|automation|tom|cyber|cost|ops",
  "label": "Specific signal label naming the actual programme or event and approximate date",
  "rawStrength": 40-95,
  "date": "YYYY-MM-DD",
  "sourceType": "evidence|inferred|speculative",
  "sourceCount": 1-5,
  "sourceTypes": ["e.g. SEC 10-K", "earnings call", "press release", "job postings"],
  "confidence": "high|medium|low",
  "excerpt": "2-3 sentences of specific intelligence about this signal with dates and details"
}]

Rules:
- Only extract signals where you have genuine knowledge
- evidence=confirmed public source, inferred=reasonable from known facts, speculative=possible from patterns
- rawStrength: 85+=named programme with confirmed details, 70-84=strong corroborated, 50-69=credible inference, <50=speculative
- For PE-backed infrastructure companies extract all available signals
- Extract 3-6 signals
- Return ONLY the JSON array`

    const sigsTxt = await claude(extractPrompt, 2000)
    type RawSig = { theme: string; label: string; rawStrength: number; date: string; sourceType: string; sourceCount: number; sourceTypes: string[]; confidence: string; excerpt: string }
    const rawSigs = parseJSON<RawSig[]>(sigsTxt)

    const today = new Date().getTime()
    const signals = rawSigs.map((s, i) => {
      const days = Math.round((today - new Date(s.date).getTime()) / 86400000)
      let tier: string, w: number
      if (days <= 14) { tier = 'live'; w = 1 }
      else if (days <= 60) { tier = 'recent'; w = 0.9 }
      else if (days <= 180) { tier = 'current'; w = 0.7 }
      else if (days <= 365) { tier = 'active'; w = 0.45 }
      else { tier = 'excluded'; w = 0 }
      const cb = s.sourceCount >= 3 ? 8 : s.sourceCount === 2 ? 4 : 0
      const adj = Math.round(s.rawStrength * w + cb)
      let conf = s.confidence, capped = false
      if (stage === 'series-a' && conf === 'high') { conf = 'medium'; capped = true }
      if (stage === 'seed') {
        if (conf === 'high') { conf = 'medium'; capped = true }
        else if (conf === 'medium') { conf = 'low'; capped = true }
      }
      return { ...s, id: `sig-${i}`, adjStrength: adj, recencyTier: tier, corroborationBonus: cb, confidence: conf, confidenceCapped: capped, days }
    }).filter(s => s.recencyTier !== 'excluded').sort((a, b) => b.adjStrength - a.adjStrength)

    await sleep(1000)

    // ── Step 3: Score ──────────────────────────────────────────────
    const caps: Record<string, number> = { public: 100, 'series-b': 100, 'series-a': 78, seed: 65, private: 100, pe: 100 }
    const cap = caps[stage] || 100
    const isPriv = resolved.track === 'private' && stage !== 'pe'
    const W = isPriv
      ? { regulatory: 0.35, technical: 0.25, operational: 0.20, market: 0.15, founder: 0.05 }
      : { signal_strength: 0.40, source_quality: 0.30, recency: 0.20, theme_coverage: 0.10 }
    const dimKeys = Object.keys(W)
    const sigSummary = signals.slice(0, 6).map((s, i) =>
      `${i + 1}. [${s.theme}] ${s.label} | score:${s.adjStrength} | conf:${s.confidence} | tier:${s.recencyTier}`
    ).join('\n')

    const scorePrompt = `Score this company for outreach readiness. Return ONLY a JSON object.

Company: ${coName} | Track: ${resolved.track} | Stage: ${stage}
Data quality: ${resolved.dataQuality}/100
${stage === 'pe' ? 'NOTE: PE-backed — score based on actual signal quality, not ownership. Should score 65-85 if signals are strong.' : ''}

Signals (${signals.length} total):
${sigSummary}

Score each dimension 0-100:
${dimKeys.map(k => `- ${k}`).join('\n')}

${isPriv
      ? 'regulatory=regulatory/legal signal strength\ntechnical=technical/scientific depth\noperational=job specificity and headcount\nmarket=investor quality and press\nfounder=leadership profile'
      : 'signal_strength=overall adjusted signal strength\nsource_quality=source independence and credibility\nrecency=signal freshness\ntheme_coverage=breadth across themes'}

Return ONLY this JSON:
{
  "dimensions": {${dimKeys.map(k => `"${k}": 0`).join(', ')}},
  "scoringRationale": "2-3 sentences specific to this company",
  "themesHit": ["array of theme ids with genuine signal"],
  "freshestSignalDays": 0
}`

    const scoreTxt = await claude(scorePrompt, 600)
    const scoreData = parseJSON<{ dimensions: Record<string, number>; scoringRationale: string; themesHit: string[]; freshestSignalDays: number }>(scoreTxt)

    const highConf = signals.filter(s => s.confidence === 'high').length
    const hcb = highConf * 2
    let raw = Object.entries(W).reduce((a, [k, w]) => a + (scoreData.dimensions[k] || 0) * w, 0)
    raw = Math.round(raw + hcb)
    const final = Math.min(raw, cap)
    const grade = final >= 80 ? 'A' : final >= 65 ? 'B' : final >= 50 ? 'C' : 'D'
    const readiness = final >= 65 ? 'Outreach ready' : final >= 45 ? 'Outreach with caveats' : 'Watch list'

    const score = {
      model: isPriv ? 'private' : 'public',
      dimensions: scoreData.dimensions,
      highConfBonus: hcb,
      raw,
      stageCap: cap,
      final,
      grade,
      readiness,
      themesHit: scoreData.themesHit || [],
      freshestDays: scoreData.freshestSignalDays || 365,
      capped: raw > cap,
      scoringRationale: scoreData.scoringRationale,
    }

    return NextResponse.json({ resolved, signals, score })

  } catch (e) {
    console.error('Pipeline error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pipeline failed' }, { status: 500 })
  }
}
