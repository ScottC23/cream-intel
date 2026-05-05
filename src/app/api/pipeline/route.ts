import { NextRequest, NextResponse } from 'next/server'

// Server-side rate limit handling
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function callClaude(
  prompt: string,
  maxTokens: number,
  useWebSearch = false,
  retries = 4
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured')

  const payload: Record<string, unknown> = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  }

  if (useWebSearch) {
    payload.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  }
  if (useWebSearch) headers['anthropic-beta'] = 'web-search-2025-03-05'

  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (r.status === 429) {
      // Exponential backoff: 10s, 20s, 40s, 60s
      const wait = Math.min(10000 * Math.pow(2, attempt), 60000)
      console.warn(`Rate limited (429) attempt ${attempt + 1}/${retries}, waiting ${wait / 1000}s`)
      await sleep(wait)
      continue
    }

    if (r.status === 529) {
      // Overloaded — same backoff
      const wait = Math.min(15000 * Math.pow(2, attempt), 60000)
      await sleep(wait)
      continue
    }

    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(`Anthropic API ${r.status}: ${JSON.stringify(err)}`)
    }

    const d = await r.json()
    const parts: string[] = []
    for (const b of (d.content || [])) {
      if (b.type === 'text' && b.text) parts.push(b.text)
      if (b.type === 'tool_result') {
        for (const c of (b.content || [])) {
          if (c.type === 'text' && c.text) parts.push(c.text)
        }
      }
    }
    return parts.join('\n\n')
  }
  throw new Error('Max retries exceeded after rate limiting')
}

function parseJSON<T>(txt: string): T {
  const clean = txt.replace(/```json\n?|\n?```/g, '').trim()
  try { return JSON.parse(clean) as T }
  catch {
    const m = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (m) return JSON.parse(m[0]) as T
    throw new Error('JSON parse failed: ' + clean.slice(0, 300))
  }
}

export async function POST(req: NextRequest) {
  try {
    const { company, themes } = await req.json()
    const { value, type, url } = company

    const domain = url || ''
    const themeDescriptions: Record<string, string> = {
      data: 'Data capability: data infrastructure, platforms, engineering, analytics, data lakes, real-time data, MDM',
      ai: 'AI readiness: AI strategy, ML programmes, generative AI, LLMs, AI platforms, AI-driven products',
      automation: 'Automation: RPA, manufacturing automation, industrial robots, workflow automation, IIoT',
      tom: 'Operating model change: restructuring, transformation, workforce change, new leadership, post-merger integration',
      cyber: 'Cyber resilience: cybersecurity investment, zero trust, incident response, CISO appointment',
      cost: 'Cost transformation: cost reduction, opex reduction, efficiency, margin improvement, restructure',
      ops: 'Operational improvement: operational excellence, process improvement, supply chain, ERP, digital operations',
    }
    const selectedThemes = themes.map((t: string) => `- ${t}: ${themeDescriptions[t] || t}`).join('\n')

    // ── STEP 1: Resolve ──────────────────────────────────────────
    const urlCtx = domain
      ? `Website URL: ${domain} — use this as primary anchor for resolution.`
      : 'No URL provided — flag ambiguity if name could match multiple entities.'

    const resolvePrompt = `You are a US company intelligence specialist. Resolve: "${value}" (${type})
${urlCtx}

Return ONLY JSON:
{"name":"official company name","track":"public|private|hybrid","stage":"public|series-b|series-a|seed|private|pe","cik":"SEC CIK or null","ticker":"ticker or null","exchange":"NYSE|NASDAQ|null","sic":"4-digit SIC or null","sicDesc":"description or null","hq":"City, State or null","employees":"~N,000 or null","sector":"primary sector","website":"domain or null","formDFiled":true|false|null,"formDAmount":"$Xm or null","investors":"lead investors or null","dataQuality":0-100,"partial":false,"resolutionNote":"2-3 sentences: business description, data quality rationale, any ambiguity"}

dataQuality: 90+=rich EDGAR or major PE-backed company with extensive press. 70-89=public with gaps OR large PE company. 50-69=private good coverage. 30-49=limited. <30=very limited.
PE-backed companies (KKR, Blackstone, etc.) often have 70-90 dataQuality despite not being listed.`

    const resolvedRaw = await callClaude(resolvePrompt, 800)
    const resolved = parseJSON<Record<string, unknown>>(resolvedRaw)

    // Small delay between steps
    await sleep(2000)

    // ── STEP 2: Research (web search) ─────────────────────────────
    const coName = resolved.name as string || value
    const sector = (resolved.sector as string) || 'Unknown'
    const stage = (resolved.stage as string) || 'private'
    const coTicker = resolved.ticker as string || ''
    const coSite = resolved.website as string || domain

    const sectorSearchAngles: Record<string, string[]> = {
      'data center': ['expansion capacity megawatts hyperscale', 'campus build leasing colocation', 'power infrastructure investment'],
      'data centre': ['expansion capacity megawatts hyperscale', 'campus build leasing colocation', 'power infrastructure investment'],
      'cloud': ['cloud platform investment data engineering', 'AI workload infrastructure', 'migration programme'],
      'pharmaceutical': ['pipeline FDA approval clinical trial', 'manufacturing investment digital health AI'],
      'financial': ['digital transformation data platform', 'regulatory compliance AI risk fintech'],
      'energy': ['renewable transition grid investment', 'digital operations sustainability'],
      'manufacturing': ['automation robotics Industry 4.0', 'supply chain operational excellence ERP SAP'],
      'real estate': ['acquisition development portfolio', 'technology sustainability ESG'],
      'healthcare': ['digital health AI diagnostics', 'data interoperability Epic Cerner'],
      'logistics': ['automation warehouse last mile', 'digital supply chain fleet technology'],
    }
    const sKey = Object.keys(sectorSearchAngles).find(k => sector.toLowerCase().includes(k)) || ''
    const angles = sectorSearchAngles[sKey] || ['technology investment', 'digital transformation', 'hiring leadership']
    const themeKw = themes.slice(0, 3).map((t: string) =>
      t === 'tom' ? 'restructuring transformation' : t === 'ops' ? 'operational improvement' :
        t === 'data' ? 'data platform engineering' : t === 'ai' ? 'artificial intelligence AI' :
          t === 'automation' ? 'automation robotics' : t === 'cost' ? 'cost efficiency' : t
    ).join(' ')
    const peNote = stage === 'pe' || resolved.track === 'hybrid'
      ? `This is a PE-backed or taken-private company. Also search for investor communications, portfolio updates, and industry analyst coverage.` : ''

    const researchPrompt = `You are a company intelligence researcher. Find recent, specific intelligence about ${coName}.
${peNote}
${coSite ? `Website: ${coSite}` : ''}
Sector: ${sector}

Search for:
1. "${coName}" news announcements 2025 2026
2. "${coName}" hiring jobs leadership appointments 2025 2026  
3. "${coName}" ${angles[0]}
4. "${coName}" ${angles[1] || 'investment expansion'}
5. "${coName}" ${themeKw}
${coTicker ? `6. ${coTicker} investor earnings analyst 2025` : ''}

For each finding: HEADLINE | DATE | SOURCE | 3-sentence detail | THEME (data/ai/automation/tom/cyber/cost/ops)
Focus on: specific investment amounts, named programmes, headcount figures, named technology platforms, leadership appointments.
If a search returns nothing useful, state that explicitly.`

    let liveResearch = ''
    try {
      liveResearch = await callClaude(researchPrompt, 2500, true)
    } catch (e) {
      console.warn('Web search failed:', e)
      liveResearch = ''
    }

    await sleep(2000)

    // ── STEP 3: Extract signals ────────────────────────────────────
    const liveSection = liveResearch.trim().length > 100
      ? `\nLIVE RESEARCH (primary source — treat as confirmed evidence):\n${liveResearch}\nEND LIVE RESEARCH\n`
      : '[No live research available — use training knowledge, mark as lower confidence]'

    const today = new Date().toISOString().slice(0, 10)
    const extractPrompt = `You are a senior intelligence analyst. Extract signals from this company's live research.

Company: ${coName} | Track: ${resolved.track} | Stage: ${stage} | Sector: ${sector}
${resolved.cik ? `CIK: ${resolved.cik}` : ''}${coTicker ? ` | Ticker: ${coTicker}` : ''}
Today: ${today}
${liveSection}

Extract signals across these themes:
${selectedThemes}

Return JSON array. Each object:
{"theme":"data|ai|automation|tom|cyber|cost|ops","label":"SPECIFIC label naming the actual programme/event/date","rawStrength":40-95,"date":"YYYY-MM-DD","sourceType":"evidence|inferred|speculative","sourceCount":1-5,"sourceTypes":["source types found"],"confidence":"high|medium|low","excerpt":"2-3 sentences of specific intelligence with dates, amounts, named programmes"}

Rules:
- LIVE RESEARCH = primary source, mark as evidence. Inference from research = inferred. Training only = speculative.
- rawStrength: 90+=specific named programme with date/amount in live research. 75-89=clearly evidenced. 60-74=credible inference. 45-59=training knowledge. <45=speculative.
- Stage caps: Series A high→medium. Seed high→medium AND medium→low.
- Extract 4-8 signals. For large infrastructure/PE companies extract all strong signals found.
- Return ONLY the JSON array`

    type RawSig = { theme:string; label:string; rawStrength:number; date:string; sourceType:string; sourceCount:number; sourceTypes:string[]; confidence:string; excerpt:string }
    const sigsRaw = await callClaude(extractPrompt, 2500)
    const rawSigs = parseJSON<RawSig[]>(sigsRaw)

    // Apply recency decay
    const todayTs = new Date(today).getTime()
    const signals = rawSigs.map((s, i) => {
      const days = Math.round((todayTs - new Date(s.date || today).getTime()) / 86400000)
      let tier: string, w: number
      if (days <= 14) { tier = 'live'; w = 1 }
      else if (days <= 60) { tier = 'recent'; w = 0.9 }
      else if (days <= 180) { tier = 'current'; w = 0.7 }
      else if (days <= 365) { tier = 'active'; w = 0.45 }
      else { tier = 'excluded'; w = 0 }
      const cb = s.sourceCount >= 3 ? 8 : s.sourceCount === 2 ? 4 : 0
      const adj = Math.round(s.rawStrength * w + cb)
      let conf = s.confidence
      let capped = false
      if (stage === 'series-a' && conf === 'high') { conf = 'medium'; capped = true }
      if (stage === 'seed') {
        if (conf === 'high') { conf = 'medium'; capped = true }
        else if (conf === 'medium') { conf = 'low'; capped = true }
      }
      return { ...s, id: `sig-${i}`, adjStrength: adj, recencyTier: tier, corroborationBonus: cb, confidence: conf, confidenceCapped: capped, days }
    }).filter(s => s.recencyTier !== 'excluded' || s.adjStrength >= 36)
      .sort((a, b) => b.adjStrength - a.adjStrength)

    await sleep(2000)

    // ── STEP 4: Score ──────────────────────────────────────────────
    const caps: Record<string, number> = { public: 100, 'series-b': 100, 'series-a': 78, seed: 65, private: 100, pe: 100 }
    const cap = caps[stage] || 100
    const isPriv = resolved.track === 'private' && stage !== 'pe'
    const W = isPriv
      ? { regulatory: 0.35, technical: 0.25, operational: 0.20, market: 0.15, founder: 0.05 }
      : { signal_strength: 0.40, source_quality: 0.30, recency: 0.20, theme_coverage: 0.10 }
    const dimKeys = Object.keys(W)
    const sigSum = signals.slice(0, 8).map((s, i) =>
      `${i + 1}. [${s.theme}] ${s.label} | adj:${s.adjStrength} | conf:${s.confidence} | tier:${s.recencyTier}`
    ).join('\n')
    const peNote2 = stage === 'pe' || resolved.track === 'hybrid'
      ? 'NOTE: PE-backed company — score based on actual signal quality. Large PE infrastructure companies should score 70-90 if intelligence is strong.' : ''

    const scorePrompt = `Score this company for outreach readiness using the ${isPriv ? 'private' : 'public'} model.

Company: ${coName} | Track: ${resolved.track} | Stage: ${stage} | Data quality: ${resolved.dataQuality}/100
${peNote2}

Signals (${signals.length} extracted):
${sigSum}

Score each dimension 0-100:
${isPriv
      ? 'regulatory=Form D/patents/grants\ntechnical=scientific/technical depth\noperational=job specificity and headcount\nmarket=investor quality and press\nfounder=leadership profile'
      : `signal_strength=overall adjusted strength across ${signals.length} signals\nsource_quality=source independence and credibility\nrecency=signal freshness (live/recent tier = higher)\ntheme_coverage=breadth across selected themes`}

Return JSON: {"dimensions":{${dimKeys.map(k => `"${k}":0`).join(',')}},"scoringRationale":"2-3 sentences specific to this company — what drives the score, what is strong, what is limited","themesHit":["theme ids with genuine signal"],"freshestSignalDays":integer}
Return ONLY JSON.`

    const scoreRaw = await callClaude(scorePrompt, 800)
    const scoreResult = parseJSON<Record<string, unknown>>(scoreRaw)

    const highConf = signals.filter(s => s.confidence === 'high').length
    const hcb = highConf * 2
    const dims = scoreResult.dimensions as Record<string, number>
    let raw = Object.entries(W).reduce((a, [k, w]) => a + (dims[k] || 0) * w, 0)
    raw = Math.round(raw + hcb)
    const final = Math.min(raw, cap)
    const grade = final >= 80 ? 'A' : final >= 65 ? 'B' : final >= 50 ? 'C' : 'D'
    const readiness = final >= 65 ? 'Outreach ready' : final >= 45 ? 'Outreach with caveats' : 'Watch list'

    const score = {
      model: isPriv ? 'private' : 'public',
      dimensions: dims,
      highConfBonus: hcb,
      raw,
      stageCap: cap,
      final,
      grade,
      readiness,
      themesHit: scoreResult.themesHit as string[],
      freshestDays: scoreResult.freshestSignalDays as number,
      capped: raw > cap,
      scoringRationale: scoreResult.scoringRationale as string,
    }

    return NextResponse.json({ resolved, signals, score })

  } catch (e) {
    console.error('Pipeline error:', e)
    const msg = e instanceof Error ? e.message : 'Pipeline failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
