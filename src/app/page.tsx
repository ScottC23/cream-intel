'use client'
import { useState, useCallback } from 'react'

/* ═══ BRAND CONSTANTS ═══ */
const THEMES=[{id:'data',label:'Data capability',color:'#1A3D5C',cls:'t-data'},{id:'ai',label:'AI readiness',color:'#2D3B6B',cls:'t-ai'},{id:'automation',label:'Automation',color:'#1E4A2A',cls:'t-automation'},{id:'tom',label:'Operating model',color:'#5C3D1A',cls:'t-tom'},{id:'cyber',label:'Cyber resilience',color:'#2D3B6B',cls:'t-cyber'},{id:'cost',label:'Cost transformation',color:'#6B2020',cls:'t-cost'},{id:'ops',label:'Operational improvement',color:'#2E5C18',cls:'t-ops'}]
const TMAP=Object.fromEntries(THEMES.map(t=>[t.id,t]))
const TICKER_RE=/^[A-Z]{1,5}$/
const NAV=[{id:'scan',label:'New scan',sub:'F01',ico:'✦'},{id:'companies',label:'Companies',sub:'F02',ico:'◈'},{id:'evidence',label:'Evidence',sub:'F04–05',ico:'◎'},{id:'roles',label:'Stakeholders',sub:'F07',ico:'◉'},{id:'outreach',label:'Outreach',sub:'F08–09',ico:'◆'},{id:'export',label:'Export',sub:'F10',ico:'⬡'}]
const ACT_LABELS:Record<string,string>={founder_direct:'Founder direct',first_outreach_target:'Best first target',technical_owner_to_validate:'Technical owner',executive_sponsor_to_map:'Executive sponsor',operational_owner:'Operational owner',capability_builder:'Capability builder',conditional_target:'Conditional',compliance_stakeholder:'Compliance'}
const ACT_CLS:Record<string,string>={founder_direct:'act-f',first_outreach_target:'act-1',technical_owner_to_validate:'act-t',executive_sponsor_to_map:'act-s',operational_owner:'act-o',capability_builder:'act-cap',conditional_target:'act-c',compliance_stakeholder:'act-c'}

/* ═══ TYPES ═══ */
interface ParsedCo{value:string;type:'name'|'ticker';src:string;url?:string;website?:string}
interface ResolvedCo{name:string;track:string;stage:string;cik?:string;ticker?:string;sic?:string;sicDesc?:string;hq?:string;employees?:string;sector?:string;website?:string;formDFiled?:boolean;formDAmount?:string;investors?:string;dataQuality:number;partial:boolean;resolutionNote:string}
interface Signal{theme:string;label:string;rawStrength:number;adjStrength:number;date:string;recencyTier:string;sourceType:string;sourceCount:number;sourceTypes:string[];confidence:string;confidenceCapped:boolean;corroborationBonus:number;excerpt:string}
interface Score{model:string;dimensions:Record<string,number>;highConfBonus:number;raw:number;stageCap:number;final:number;grade:string;readiness:string;themesHit:string[];freshestDays:number;capped:boolean;scoringRationale:string}
interface Role{title:string;department:string;priority:string;action:string;actionLabel:string;score:number;whyMatters:string;howToUse:string;evidenceConf:string;evidenceConfNote:string;inferenceRisk:string;inferenceRiskNote:string;inferenceNote?:string;topics:{text:string;tag:string}[];firstQuestion:string}
interface Angle{hypothesis:string;triggerEvent:string;evidenceChain:string[];approachRationale:string}
interface EmailDraft{subject:string;body:string}
interface ScannedCo{id:string;input:ParsedCo;resolved?:ResolvedCo;signals?:Signal[];score?:Score;roles?:Role[];status:'pending'|'resolving'|'researching'|'extracting'|'scoring'|'done'|'error';error?:string}

/* ═══ HELPERS ═══ */
function scoreColor(n:number){return n>=65?'var(--green)':n>=45?'var(--amber)':'var(--red)'}
function tierCls(t:string){return({live:'tl',recent:'tr',current:'tc',active:'ta'} as Record<string,string>)[t]||'ta'}
function tierLbl(t:string){return({live:'Live',recent:'Recent',current:'Current',active:'Active'} as Record<string,string>)[t]||t}
function confCls(c:string){return({high:'ch',medium:'cm',low:'cl'} as Record<string,string>)[c]||'cl'}
function parseList(raw:string):ParsedCo[]{const out:ParsedCo[]=[],seen=new Set<string>();for(const line of raw.split(/[\n\r]+/)){for(let p of line.split(/[\t,]+/)){p=p.replace(/^\s*\d+[\.\)\-\:]\s*/,'').replace(/["""'']/g,'').trim();if(!p||p.length<2)continue;const key=p.toLowerCase();if(seen.has(key))continue;seen.add(key);const up=p.toUpperCase();out.push({value:TICKER_RE.test(up)?up:p,type:TICKER_RE.test(up)?'ticker':'name',src:'list'})}}return out}

/* ═══ CLAUDE API ═══ */
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))

async function ask(prompt:string,maxT=2000,retries=3):Promise<string>{
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:maxT})})
      if(r.status===429){
        // Rate limited — wait with exponential backoff then retry
        const wait=[15000,30000,60000][attempt]||60000
        console.warn(`Rate limited (429), waiting ${wait/1000}s before retry ${attempt+1}/${retries}`)
        await sleep(wait)
        continue
      }
      if(!r.ok)throw new Error(`API ${r.status}`)
      const d=await r.json()
      return d.content.filter((b:{type:string})=>b.type==='text').map((b:{text:string})=>b.text).join('')
    }catch(e){
      if(attempt===retries)throw e
      await sleep(4000)
    }
  }
  throw new Error('Max retries exceeded')
}
async function askJSON<T>(prompt:string,maxT=2000):Promise<T>{
  const txt=await ask(prompt,maxT)
  const clean=txt.replace(/```json\n?|\n?```/g,'').trim()
  try{return JSON.parse(clean) as T}catch{const m=clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);if(m)return JSON.parse(m[0]) as T;throw new Error('JSON parse failed')}
}

// Web search — calls API with search tool enabled, extracts all text from response
async function askWithSearch(prompt:string,maxT=3000,retries=3):Promise<string>{
  for(let attempt=0;attempt<=retries;attempt++){
    const r=await fetch('/api/generate',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:maxT,use_web_search:true})
    })
    if(r.status===429){
      const wait=[20000,40000,60000][attempt]||60000
      console.warn(`Search rate limited (429), waiting ${wait/1000}s`)
      await sleep(wait)
      continue
    }
    if(!r.ok)throw new Error(`Search API ${r.status}`)
    const d=await r.json()
    // Extract text from all content blocks (text + tool results)
    const parts:string[]=[]
    for(const b of (d.content||[])){
      if(b.type==='text'&&b.text)parts.push(b.text)
      if(b.type==='tool_result'){
        for(const c of (b.content||[])){if(c.type==='text'&&c.text)parts.push(c.text)}
      }
    }
    return parts.join('\n\n')
  }
  throw new Error('Max retries exceeded')
}

// Research a company using live web search — runs multiple targeted searches
async function researchCompany(co:ResolvedCo,themes:string[],inputUrl?:string):Promise<string>{
  const domain=co.website||inputUrl||''
  const ticker=co.ticker?`(${co.ticker})`:'  '
  const themeKeywords=themes.map(t=>({
    data:'data platform engineering analytics',
    ai:'AI artificial intelligence machine learning',
    automation:'automation robotics RPA process',
    tom:'restructuring transformation operating model leadership',
    cyber:'cybersecurity CISO security investment',
    cost:'cost reduction efficiency restructure margin',
    ops:'operational improvement supply chain ERP performance',
  }[t]||t)).join(' OR ')

  // Sector-specific search angles produce richer signal than generic queries
  const sectorSearchAngles:{[k:string]:string[]} = {
    'data center':     ['expansion capacity megawatts','hyperscale colocation','campus build','leasing activity','power infrastructure'],
    'data centre':     ['expansion capacity megawatts','hyperscale colocation','campus build','leasing activity','power infrastructure'],
    'cloud':           ['cloud platform investment','infrastructure build','data engineering','AI workload','migration programme'],
    'pharmaceutical':  ['pipeline FDA approval','clinical trial','manufacturing investment','digital health AI'],
    'real estate':     ['acquisition development','portfolio expansion','technology investment','sustainability ESG'],
    'financial':       ['digital transformation','data platform','regulatory compliance','AI risk','fintech investment'],
    'energy':          ['renewable transition','grid investment','digital operations','sustainability programme'],
    'manufacturing':   ['automation robotics','Industry 4.0','supply chain','operational excellence','ERP SAP'],
    'technology':      ['product launch','engineering hiring','AI platform','cloud infrastructure','technical leadership'],
    'healthcare':      ['digital health','AI diagnostics','data interoperability','HIMSS','Epic Cerner'],
    'logistics':       ['automation warehouse','last mile','digital supply chain','fleet technology'],
  }
  const sector=(co.sector||'').toLowerCase()
  const sectorKey=Object.keys(sectorSearchAngles).find(k=>sector.includes(k))||''
  const sectorAngles=sectorSearchAngles[sectorKey]||['technology investment','digital transformation','hiring growth','leadership change']
  
  // For PE-backed / taken-private companies, search investor communications too
  const peContext = co.stage==='pe'||co.track==='hybrid' ? 
    `Note: This company is PE-backed or taken private. Search for: investor presentations, annual reports, portfolio company updates from the PE owner, industry analyst coverage (DC Advisory, JLL, CBRE, Green Street), and trade press. These companies often have extensive non-EDGAR public intelligence.` : ''

  const searchPrompt=`You are a company intelligence researcher. Your job is to surface specific, recent, actionable intelligence about this company — not generic descriptions.

Company: ${co.name} ${ticker}
${domain?`Website: ${domain}`:''}
Sector: ${co.sector||'Unknown'} | Stage: ${co.stage}
${peContext}

Run the following targeted searches and extract findings:

SEARCH 1: "${co.name}" news announcements 2025 2026
SEARCH 2: "${co.name}" hiring jobs leadership appointments 2025
SEARCH 3: "${co.name}" ${sectorAngles[0]||'technology investment'} ${sectorAngles[1]||'digital transformation'}
SEARCH 4: "${co.name}" ${sectorAngles[2]||'expansion growth'} ${sectorAngles[3]||'strategic investment'}
SEARCH 5: "${co.name}" ${themes.slice(0,3).map(t=>t==='tom'?'restructuring transformation':t==='ops'?'operational improvement':t==='data'?'data platform':t==='ai'?'artificial intelligence AI':t).join(' ')}
${co.ticker?`SEARCH 6: ${co.ticker} investor presentation earnings analyst 2025 2026`:''}
${co.stage==='pe'||co.track==='hybrid'?`SEARCH 7: "${co.name}" ${co.investors||'private equity'} portfolio investment expansion`:''}

For EACH finding, provide:
- HEADLINE: exact title or headline
- DATE: specific date (day/month/year) — this is critical for signal recency scoring
- SOURCE: publication, filing type, or platform
- DETAIL: 3-4 sentences of specific operational intelligence — what is actually happening, what investment was made, what is being built, who was hired, what was announced
- SIGNAL TYPE: which theme this relates to (data/ai/automation/tom/cyber/cost/ops)

Focus on: specific named programmes, investment amounts, headcount figures, technology platforms named, partnership details, leadership names and titles.
Discard: general company descriptions, boilerplate about what the company does, vague statements without specifics.
Be explicit when a search returns no useful recent results.`

  try{
    return await askWithSearch(searchPrompt, 3000)
  }catch(e){
    console.warn('Web search failed, falling back to knowledge-only mode:', e)
    return ''
  }
}

/* ═══ INTELLIGENCE PIPELINE ═══ */
async function resolveCompany(input:string,type:'name'|'ticker',url?:string):Promise<ResolvedCo>{
  const urlContext = url ? `
Website URL provided: ${url}
This URL is the PRIMARY anchor for resolution. Use the domain to identify the exact company — do not guess from the name alone.
Extract the company identity from this specific domain. If the domain clearly identifies the company, prioritise this over any name ambiguity.` : `
No URL provided. Resolve from name/ticker only — flag ambiguity in resolutionNote if the name could match multiple entities.`

  return askJSON<ResolvedCo>(`You are a US company intelligence specialist with deep knowledge of SEC EDGAR, US public markets, and the private company ecosystem including VC-backed companies, Form D filings, and startup intelligence.

Resolve this company: "${input}" (type: ${type})
${urlContext}

Return ONLY a JSON object:
{"name":"official registered company name","track":"public|private|hybrid","stage":"public|series-b|series-a|seed|private|pe","cik":"SEC CIK with leading zeros or null","ticker":"exchange ticker or null","exchange":"NYSE|NASDAQ|null","sic":"4-digit SIC or null","sicDesc":"SIC description or null","hq":"City, State or null","employees":"approximate e.g. ~5,000 or null","sector":"primary sector description","website":"canonical website domain e.g. sidara.com or null","formDFiled":true|false|null,"formDAmount":"most recent raise e.g. $50m or null","investors":"lead investors if known or null","dataQuality":0-100,"partial":false,"resolutionNote":"2-3 sentences: what was found, the company primary business, any ambiguity or data caveats. If a URL was provided confirm whether it matches the resolved entity."}

dataQuality: 90+=rich EDGAR/public history or major PE-backed company with extensive press coverage. 70-89=public with some gaps OR large PE/taken-private company with good press and investor coverage. 50-69=private with good press coverage. 30-49=limited public signal. <30=very limited.
hybrid=foreign subsidiary still filing with SEC, OR company taken private by PE (e.g. KKR, Blackstone, Carlyle) that retains significant public presence — these often have MORE signal than listed companies.
pe=company owned by private equity with institutional backing — dataQuality should reflect actual press/analyst coverage, not just EDGAR availability.
CRITICAL: Do not set dataQuality low just because a company is not publicly listed. Companies like QTS Realty (Blackstone), CyrusOne (KKR), Switch (DigitalBridge) have extensive public intelligence despite PE ownership.
IMPORTANT: If the company name is ambiguous and no URL was provided, note this clearly in resolutionNote and set dataQuality lower to reflect uncertainty.`)
}

async function extractSignals(co:ResolvedCo,themes:string[],inputUrl?:string,liveResearch?:string):Promise<Signal[]>{
  const themeDesc:Record<string,string>={data:'Data capability: data infrastructure, platforms, engineering, analytics, data lakes, data mesh, real-time data, MDM',ai:'AI readiness: AI strategy, machine learning, generative AI, LLMs, AI platforms, ML engineering, AI-driven products',automation:'Automation: RPA, manufacturing automation, industrial robots, workflow automation, autonomous systems, IIoT',tom:'Operating model change: restructuring, digital transformation, operating model redesign, workforce change, new leadership, post-merger integration',cyber:'Cyber resilience: cybersecurity investment, security transformation, zero trust, incident response, CISO appointment, SOC',cost:'Cost transformation: cost reduction, opex reduction, efficiency, margin improvement, workforce restructure with capability focus',ops:'Operational improvement: operational excellence, process improvement, supply chain, ERP, digital operations, performance programmes'}
  const selected=themes.map(t=>`- ${t}: ${themeDesc[t]||t}`).join('\n')
  const liveSection=liveResearch&&liveResearch.trim().length>50?`
═══════════════════════════════════════
LIVE RESEARCH BRIEF (web-searched, last 60 days)
Use this as your PRIMARY source of evidence. These are real, recent findings.
Treat dates, sources, and specifics from this section as confirmed evidence.
═══════════════════════════════════════
${liveResearch}
═══════════════════════════════════════
END LIVE RESEARCH — now extract signals from the above
═══════════════════════════════════════
`:`[No live research available — extract signals from your training knowledge, marking as lower confidence]`

  const sigs=await askJSON<{theme:string;label:string;rawStrength:number;date:string;sourceType:string;sourceCount:number;sourceTypes:string[];confidence:string;excerpt:string}[]>(`You are a senior intelligence analyst at a specialist recruitment and BD firm. Extract enterprise-grade intelligence signals grounded in the live research brief provided below.

Company: ${co.name} | Track: ${co.track} | Stage: ${co.stage} | Sector: ${co.sector||'Unknown'}
${co.cik?`CIK: ${co.cik}`:''}${co.ticker?` | Ticker: ${co.ticker}`:''}
${co.website?`Website: ${co.website}`:inputUrl?`Input URL: ${inputUrl}`:''}
Today: 2026-05-01

${liveSection}

Extract signals across these themes:
${selected}

Using your knowledge — SEC filings, earnings calls, press releases, job postings, investor announcements, leadership changes, acquisitions, strategic statements — extract specific signals.

Return JSON array. Each object:
{"theme":"data|ai|automation|tom|cyber|cost|ops","label":"SPECIFIC factual label naming the actual programme/event/date e.g. 'Lincoln Electric launches AI welding optimisation platform January 2026' NOT 'AI investment'","rawStrength":40-95,"date":"YYYY-MM-DD of most recent evidence","sourceType":"evidence|inferred|speculative","sourceCount":1-5,"sourceTypes":["SEC 10-K","earnings call","press release","job postings","investor presentation","news","Form D","USPTO patent","conference"],"confidence":"high|medium|low","excerpt":"2-3 sentences of SPECIFIC factual intelligence. Name programmes, percentages, dollar amounts, dates. Be precise about what the signal means operationally."}

Critical rules:
- LIVE RESEARCH IS YOUR PRIMARY SOURCE — extract signals grounded in the research brief above first
- Evidence from the live research brief = "evidence" sourceType; things you can infer from it = "inferred"; training knowledge only = "speculative"
- Never fabricate — if the research brief doesn't confirm something, mark it appropriately
- Series A caps high→medium; Seed caps high→medium AND medium→low  
- rawStrength: 90+=named programme with specific dates/amounts in live research; 75-89=clearly evidenced in research; 60-74=credible inferred from research; 45-59=training knowledge; <45=speculative
- For signals found in live research: set date to the actual article/filing date found
- Extract 4-8 signals — more for well-researched large companies, fewer for limited signal companies
- For PE-backed infrastructure companies (data centres, logistics, manufacturing) extract all strong signals found — do not artificially limit
- Return ONLY the JSON array`,3500)
  const today=new Date('2026-05-01').getTime()
  return sigs.map(s=>{
    const days=Math.round((today-new Date(s.date).getTime())/86400000)
    let tier:string,w:number
    if(days<=14){tier='live';w=1}else if(days<=60){tier='recent';w=.9}else if(days<=180){tier='current';w=.7}else if(days<=365){tier='active';w=.45}else{tier='excluded';w=0}
    const cb=s.sourceCount>=3?8:s.sourceCount===2?4:0
    const adj=Math.round(s.rawStrength*w+cb)
    let conf=s.confidence,capped=false
    const stage=(co.stage||'').toLowerCase()
    if(stage==='series-a'&&s.confidence==='high'){conf='medium';capped=true}
    if(stage==='seed'){if(s.confidence==='high'){conf='medium';capped=true}else if(s.confidence==='medium'){conf='low';capped=true}}
    return{...s,adjStrength:adj,recencyTier:tier,corroborationBonus:cb,confidence:conf,confidenceCapped:capped}
  }).filter(s=>s.recencyTier!=='excluded'||s.rawStrength>=80).sort((a,b)=>b.adjStrength-a.adjStrength)
}

async function scoreCompany(co:ResolvedCo,sigs:Signal[]):Promise<Score>{
  const caps:Record<string,number>={public:100,'series-b':100,'series-a':78,seed:65,private:100,pe:100}
  const cap=caps[co.stage?.toLowerCase()||'private']||100
  // Hybrid = large company with public footprint, use public model
  // Pure private with no SEC history uses private model
  const isPriv=co.track==='private'&&co.stage!=='pe'
  const dimKeys=isPriv?['regulatory','technical','operational','market','founder']:['signal_strength','source_quality','recency','theme_coverage']
  const W=isPriv?{regulatory:.35,technical:.25,operational:.20,market:.15,founder:.05}:{signal_strength:.40,source_quality:.30,recency:.20,theme_coverage:.10}
  const sigSum=sigs.slice(0,8).map((s,i)=>`${i+1}. [${s.theme}] ${s.label} | adj:${s.adjStrength} | conf:${s.confidence} | tier:${s.recencyTier} | sources:${s.sourceCount}`).join('\n')
  const res=await askJSON<{dimensions:Record<string,number>;scoringRationale:string;themesHit:string[];freshestSignalDays:number}>(`Score this company for outreach readiness using the ${isPriv?'private':'public'} company intelligence model.

Company: ${co.name} | Track: ${co.track} | Stage: ${co.stage} | Data quality: ${co.dataQuality}/100
${co.stage==='pe'?'NOTE: PE-backed company — score based on actual signal quality, not ownership structure. Large PE-backed infrastructure companies (data centres, logistics, manufacturing) can score 70-90 if the intelligence is strong.':''}
${co.track==='hybrid'?'NOTE: Hybrid entity — score as you would a large private company with public-equivalent intelligence available.':''}

Top signals (${sigs.length} total extracted):
${sigSum}

Score each dimension 0-100. Be accurate — a well-documented PE infrastructure company with strong hiring signals and recent press should score 70+, not sub-50.
${isPriv?'regulatory=Form D/patents/grants/compliance signal strength\ntechnical=scientific/technical signal depth\noperational=job posting specificity, headcount growth, named programmes\nmarket=investor quality, press coverage volume and recency\nfounder=leadership public profile and track record':'signal_strength=overall adjusted signal strength across all ${sigs.length} signals\nsource_quality=source independence, credibility, and diversity\nrecency=signal freshness — live/recent tier signals score higher\ntheme_coverage=breadth across the selected themes'}

Return JSON: {"dimensions":{${dimKeys.map(k=>`"${k}":0`).join(',')}},"scoringRationale":"2-3 sentences explaining the score specifically for THIS company","themesHit":["theme ids with genuine signal"],"freshestSignalDays":integer}
Return ONLY JSON.`)
  const highConf=sigs.filter(s=>s.confidence==='high').length
  const hcb=highConf*2
  let raw=Object.entries(W).reduce((a,[k,w])=>a+(res.dimensions[k]||0)*w,0)
  raw=Math.round(raw+hcb)
  const final=Math.min(raw,cap)
  const grade=final>=80?'A':final>=65?'B':final>=50?'C':'D'
  const readiness=final>=65?'Outreach ready':final>=45?'Outreach with caveats':'Watch list'
  return{model:isPriv?'private':'public',dimensions:res.dimensions,highConfBonus:hcb,raw,stageCap:cap,final,grade,readiness,themesHit:res.themesHit,freshestDays:res.freshestSignalDays,capped:raw>cap,scoringRationale:res.scoringRationale}
}

async function mapStakeholders(co:ResolvedCo,sigs:Signal[],sc:Score):Promise<Role[]>{
  const isPriv=co.track==='private'&&co.stage!=='pe'
  const topSigs=sigs.slice(0,5).map(s=>`- [${s.theme.toUpperCase()}] ${s.label} (${s.confidence}, ${s.recencyTier})`).join('\n')
  const acts=isPriv?'founder_direct, first_outreach_target, technical_owner_to_validate, conditional_target':'first_outreach_target, technical_owner_to_validate, executive_sponsor_to_map, operational_owner, capability_builder, compliance_stakeholder, conditional_target'
  return askJSON<Role[]>(`You are a specialist recruiter and BD advisor. Map stakeholder roles for outreach grounded in the specific signals detected.

Company: ${co.name} | Track: ${co.track} | Stage: ${co.stage} | Sector: ${co.sector||'Unknown'}
${co.employees?`Employees: ${co.employees}`:''}
Score: ${sc.final}/100 | Grade: ${sc.grade}

Top signals:
${topSigs}

${isPriv?'Private company: org flat, founders accessible, inference risk higher. At Seed/Series A one person may hold multiple roles. Only map roles that can plausibly exist at this stage.':'Public company: functional ownership more defined. VP/Director layers exist. The functional owner often beats C-suite for first outreach. Do not default to listing only C-suite roles.'}

Map 2-4 stakeholder roles. Return JSON array:
[{"title":"specific role title","department":"dept name","priority":"primary|secondary|tertiary","action":"one of: ${acts}","actionLabel":"human readable label","score":50-95,"whyMatters":"2-3 sentences grounded in THESE specific signals at THIS company NOW — why is this role relevant to these exact signals","howToUse":"2-3 sentences: first vs follow-up contact, what angle to lead with, what to avoid","evidenceConf":"High|Medium|Low","evidenceConfNote":"what confirms or limits confidence in this role","inferenceRisk":"Low|Medium|High","inferenceRiskNote":"inference risk rationale","inferenceNote":"warning if role unconfirmed or null","topics":[{"text":"specific topic grounded in a signal","tag":"evidence|inferred|speculative"},{"text":"...","tag":"..."},{"text":"...","tag":"..."}],"firstQuestion":"one precise open question SPECIFIC to this company's operational context — not generic"}]

Rules: Min 3 topics per role each grounded in signals. firstQuestion must be specific to this company. Do not invent roles signals do not support. Return ONLY JSON array.`,2500)
}

async function buildAngle(co:ResolvedCo,role:Role,sigs:Signal[]):Promise<Angle>{
  return askJSON<Angle>(`Build a specific evidence-grounded outreach angle for ${role.title} at ${co.name}.
Sector: ${co.sector} | Why this role: ${role.whyMatters}
Top signals: ${sigs.slice(0,4).map(s=>s.label).join('; ')}
Return JSON: {"hypothesis":"2-3 sentences — what is this company dealing with RIGHT NOW that makes outreach timely and relevant","triggerEvent":"the single most compelling recent event or signal that makes NOW the right time","evidenceChain":["3-4 specific evidence items from strongest to supporting"],"approachRationale":"2-3 sentences — what to lead with, what tension to name, what question to open with"}
Return ONLY JSON.`)
}

async function draftLI(co:ResolvedCo,role:Role,angle:Angle,tone:string):Promise<string>{
  const tones:Record<string,string>={consultative:'consultative and respectful — lead with their operational reality, acknowledge the specific challenge without pitching, close with one precise open question that invites them to share their perspective',direct:'direct and efficient — one sharp observation showing you understand their specific situation, one focused question, no preamble and no padding',challenger:'lightly challenging — name a tension or constraint they may not have fully resolved, frame a perspective they may not have considered, ask a question that invites honest engagement'}
  const txt=await ask(`Draft a LinkedIn connection request message body for ${role.title} at ${co.name}.
Prefixed with "[First name], " (14 chars reserved). Body limit: 286 characters maximum. Count precisely.
Outreach angle: ${angle.hypothesis}
Trigger: ${angle.triggerEvent}
Tone: ${tones[tone]||tones.consultative}
Rules (non-negotiable): No dashes of any kind (no - no – no —). No "curious","worth a quick chat","touch base","explore","reach out","hoping to connect". No greeting. Start with specific observation grounded in the evidence. End with exactly one open question. Every word earns its place.
Return ONLY the message body. No quotes, no labels, no explanation.`,400)
  return txt.trim().replace(/^["'`]|["'`]$/g,'').slice(0,286)
}

async function draftEmailFn(co:ResolvedCo,role:Role,angle:Angle,tone:string):Promise<EmailDraft>{
  const tones:Record<string,string>={consultative:'consultative — lead with their operational reality, imply value from their context without stating it directly, close with one open question',direct:'direct — sharp observation, 2-3 woven topics naturally not as a list, precise close',challenger:'challenging — name a tension or constraint, frame a perspective, honest question'}
  return askJSON<EmailDraft>(`Draft a first-touch cold email to ${role.title} at ${co.name}.
Angle: ${angle.hypothesis}
Trigger: ${angle.triggerEvent}
Approach: ${angle.approachRationale}
Tone: ${tones[tone]||tones.consultative}
Rules (non-negotiable): No dashes anywhere. No "curious","worth a quick chat","I wanted to reach out","I noticed that","I came across". Body 120-160 words max. Subject under 8 words, no clickbait. Weave 2-3 topics naturally. Close with one open question. Sign off: [Your name].
Return ONLY JSON: {"subject":"...","body":"..."} — no markdown, no code fences.`,800)
}

/* ═══ MAIN APP ═══ */
export default function App(){
  const [active,setActive]=useState('scan')
  const [scanId,setScanId]=useState<string|null>(null)
  const [scanThemes,setScanThemes]=useState<string[]>([])
  const [companies,setCompanies]=useState<ScannedCo[]>([])
  const [liDrafts,setLiDrafts]=useState<Record<string,string>>({})
  const [emailDrafts,setEmailDrafts]=useState<Record<string,EmailDraft>>({})
  const [angles,setAngles]=useState<Record<string,Angle>>({})

  const updateCo=useCallback((id:string,patch:Partial<ScannedCo>)=>{setCompanies(prev=>prev.map(c=>c.id===id?{...c,...patch}:c))},[])
  const sorted=[...companies].sort((a,b)=>(b.score?.final||0)-(a.score?.final||0))

  async function runScan(cos:ParsedCo[],themes:string[]){
    const id='CRM-'+Date.now().toString(36).toUpperCase()
    setScanId(id);setScanThemes(themes)
    const init:ScannedCo[]=cos.map((c,i)=>({id:`co-${i}`,input:c,status:'pending'}))
    setCompanies(init);setActive('companies')
    // Process companies sequentially through server-side pipeline
    // Each company = 1 request to /api/pipeline (which handles all steps server-side)
    for(let ci=0;ci<init.length;ci++){
      // Small stagger between companies
      if(ci>0) await sleep(3000)
      const co=init[ci]
      try{
        updateCo(co.id,{status:'researching' as ScannedCo['status']})
        // 270s timeout — slightly under Vercel's 300s function limit
        const controller=new AbortController()
        const timeout=setTimeout(()=>controller.abort(),270000)
        let r:Response
        try{
          r=await fetch('/api/pipeline',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({company:co.input,themes}),
            signal:controller.signal
          })
        }finally{clearTimeout(timeout)}
        if(!r.ok){
          const err=await r.json().catch(()=>({}))
          throw new Error(err.error||`Pipeline error ${r.status}`)
        }
        const result=await r.json()
        if(!result.resolved)throw new Error('No data returned from pipeline')
        updateCo(co.id,{
          resolved:result.resolved,
          signals:result.signals||[],
          score:result.score,
          status:result.score?'done':'error',
          error:result.score?undefined:'Scoring incomplete'
        })
      }catch(e){updateCo(co.id,{status:'error',error:e instanceof Error?e.message:'Processing failed'})}
    }
  }

  async function handleMapRoles(coId:string){
    const co=companies.find(c=>c.id===coId)
    if(!co?.resolved||!co?.signals||!co?.score)return
    try{const roles=await mapStakeholders(co.resolved,co.signals,co.score);updateCo(coId,{roles})}catch(e){console.error(e)}
  }

  async function handleBuildAngle(coId:string,ri:number){
    const co=companies.find(c=>c.id===coId)
    if(!co?.resolved||!co?.signals||!co?.roles?.[ri])return
    try{const a=await buildAngle(co.resolved,co.roles[ri],co.signals);setAngles(p=>({...p,[`${coId}-${ri}`]:a}))}catch(e){console.error(e)}
  }

  async function handleDraftLI(coId:string,ri:number,tone:string){
    const co=companies.find(c=>c.id===coId)
    if(!co?.resolved||!co?.roles?.[ri])return
    const role=co.roles[ri]
    const angle=angles[`${coId}-${ri}`]||{hypothesis:role.whyMatters,triggerEvent:co.signals?.[0]?.label||'',evidenceChain:[],approachRationale:role.howToUse}
    try{const d=await draftLI(co.resolved,role,angle,tone);setLiDrafts(p=>({...p,[`${coId}-${ri}-${tone}`]:d}))}catch(e){console.error(e)}
  }

  async function handleDraftEmail(coId:string,ri:number,tone:string){
    const co=companies.find(c=>c.id===coId)
    if(!co?.resolved||!co?.roles?.[ri])return
    const role=co.roles[ri]
    const angle=angles[`${coId}-${ri}`]||{hypothesis:role.whyMatters,triggerEvent:co.signals?.[0]?.label||'',evidenceChain:[],approachRationale:role.howToUse}
    try{const d=await draftEmailFn(co.resolved,role,angle,tone);setEmailDrafts(p=>({...p,[`${coId}-${ri}-${tone}`]:d}))}catch(e){console.error(e)}
  }

  return(
    <div className="app">
      <aside className="sb">
        <div className="sb-head">
          <div className="logo-mark"><span className="logo-c">c</span></div>
          <span className="logo-word">cream</span>
        </div>
        <div className="sb-sect">Intelligence</div>
        <nav className="sb-nav">
          {NAV.map(n=>(
            <button key={n.id} className={`nb${active===n.id?' on':''}`} onClick={()=>setActive(n.id)}>
              <span className="nb-ico">{n.ico}</span>
              <div className="nb-txt"><span className="nb-lbl">{n.label}</span><span className="nb-sub">{n.sub}</span></div>
            </button>
          ))}
        </nav>
        <div className="sb-foot">
          <span className="sb-ver">v0.5</span>
          <div className="live"><span className="live-dot"/>live</div>
        </div>
      </aside>
      <main className="main">
        <div className="mh">
          <div className="mh-left">
            <div className="mh-eye">{NAV.find(n=>n.id===active)?.sub}</div>
            <h1 className="mh-title">{NAV.find(n=>n.id===active)?.label}</h1>
          </div>
          {scanId&&<div className="scan-pill">✓ {companies.length} companies · {scanThemes.length} themes</div>}
        </div>
        <div className="scroll">
          {active==='scan'&&<ScanView onScan={runScan} hasScan={!!scanId} scanId={scanId} companies={companies}/>}
          {active==='companies'&&<CompaniesView companies={sorted} hasScan={!!scanId}/>}
          {active==='evidence'&&<EvidenceView companies={sorted} hasScan={!!scanId}/>}
          {active==='roles'&&<RolesView companies={sorted} onMapRoles={handleMapRoles} hasScan={!!scanId}/>}
          {active==='outreach'&&<OutreachView companies={sorted} liDrafts={liDrafts} emailDrafts={emailDrafts} angles={angles} onBuildAngle={handleBuildAngle} onDraftLI={handleDraftLI} onDraftEmail={handleDraftEmail} hasScan={!!scanId}/>}
          {active==='export'&&<ExportView companies={sorted} liDrafts={liDrafts} emailDrafts={emailDrafts} hasScan={!!scanId}/>}
        </div>
      </main>
    </div>
  )
}

/* ═══ F01 SCAN ═══ */
function ScanView({onScan,hasScan,scanId,companies}:{onScan:(cos:ParsedCo[],themes:string[])=>void;hasScan:boolean;scanId:string|null;companies:ScannedCo[]}){
  // Structured entries: name + optional URL
  const [entries,setEntries]=useState<{name:string;url:string}[]>([{name:'',url:''}])
  const [list,setList]=useState('')
  const [themes,setThemes]=useState<Set<string>>(new Set());const [sam,setSam]=useState(false)
  const [errs,setErrs]=useState<{co?:string;th?:string}>({});const [scanning,setScanning]=useState(false)
  const [inputMode,setInputMode]=useState<'structured'|'paste'>('structured')

  const addEntry=()=>setEntries(e=>[...e,{name:'',url:''}])
  const removeEntry=(i:number)=>setEntries(e=>e.filter((_,j)=>j!==i))
  const updateEntry=(i:number,field:'name'|'url',val:string)=>setEntries(e=>e.map((en,j)=>j===i?{...en,[field]:val}:en))

  const cos2=useCallback(():ParsedCo[]=>{
    const out:ParsedCo[]=[],seen=new Set<string>()
    if(inputMode==='structured'){
      for(const en of entries){
        const n=en.name.trim()
        if(!n)continue
        const key=n.toLowerCase()
        if(seen.has(key))continue
        seen.add(key)
        const up=n.toUpperCase()
        const isT=TICKER_RE.test(up)
        // Extract clean domain from URL
        let cleanUrl:string|undefined=undefined
        if(en.url.trim()){
          try{
            const raw=en.url.trim()
            const withProto=raw.startsWith('http')?raw:'https://'+raw
            cleanUrl=new URL(withProto).hostname.replace(/^www\./,'')
          }catch{cleanUrl=en.url.trim().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]}
        }
        out.push({value:isT?up:n,type:isT?'ticker':'name',src:'structured',url:cleanUrl,website:cleanUrl})
      }
    } else {
      for(const c of parseList(list)){
        if(!seen.has(c.value.toLowerCase())){seen.add(c.value.toLowerCase());out.push(c)}
      }
    }
    return out
  },[entries,list,inputMode])

  const validate=()=>{const e:{co?:string;th?:string}={};if(cos2().length===0)e.co='Add at least one company.';if(themes.size===0)e.th='Select at least one theme.';setErrs(e);return!e.co&&!e.th}
  const handleCreate=async()=>{if(!validate())return;setScanning(true);await onScan(cos2(),Array.from(themes));setScanning(false)}
  const cos=cos2()
  const done=companies.filter(c=>c.status==='done').length
  if(hasScan&&scanId)return(
    <div>
      <div className="succ">
        <div className="succ-ico">{done===companies.length?'✓':'…'}</div>
        <div style={{flex:1}}>
          <div className="succ-ttl">{done===companies.length?'Intelligence complete':'Generating intelligence…'}</div>
          <div className="succ-meta"><code>{scanId}</code> · {done}/{companies.length} companies processed · {done<companies.length?`${companies.length-done} still running`:'all complete'}</div>
          {done<companies.length&&<div className="progwrap" style={{marginTop:8,maxWidth:300}}><div className="progfill" style={{width:`${companies.length>0?Math.round(done/companies.length*100):0}%`}}/></div>}
        </div>
        <button className="btn-ghost" onClick={()=>window.location.reload()}>new scan</button>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:4,maxWidth:700}}>
        {companies.map(co=>(
          <div key={co.id} className="proc-row">
            <div className="proc-dot" style={{background:co.status==='done'?'var(--green)':co.status==='error'?'var(--red)':'var(--camel-500)',boxShadow:co.status!=='done'&&co.status!=='error'&&co.status!=='pending'?'0 0 8px rgba(184,150,106,.6)':'none'}}/>
            <div className="proc-name">{co.resolved?.name||co.input.value}</div>
            <div className="proc-status">{co.status==='pending'?'waiting…':co.status==='researching'?'researching…':co.status==='done'?`score ${co.score?.final} · grade ${co.score?.grade}`:co.error?`error: ${co.error.slice(0,40)}`:'error'}</div>
            {co.score&&<div className={`gc ${co.score.grade==='A'?'ga':co.score.grade==='B'?'gb':co.score.grade==='C'?'gc2':'gd'}`}>{co.score.grade}</div>}
          </div>
        ))}
      </div>
    </div>
  )
  return(
    <div className="card">
      <div className="csect">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div className="slbl" style={{marginBottom:0}}>Company input</div>
          <div style={{display:'flex',gap:2,background:'var(--cream-200)',borderRadius:'var(--r-sm)',padding:2}}>
            <button onClick={()=>setInputMode('structured')} style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-xs)',border:'none',cursor:'pointer',background:inputMode==='structured'?'var(--cream-50)':'transparent',color:inputMode==='structured'?'var(--teal-800)':'var(--teal-400)',fontFamily:'var(--f-sans)',fontWeight:inputMode==='structured'?500:400,transition:'all .1s'}}>Add by name + URL</button>
            <button onClick={()=>setInputMode('paste')} style={{fontSize:11,padding:'4px 10px',borderRadius:'var(--r-xs)',border:'none',cursor:'pointer',background:inputMode==='paste'?'var(--cream-50)':'transparent',color:inputMode==='paste'?'var(--teal-800)':'var(--teal-400)',fontFamily:'var(--f-sans)',fontWeight:inputMode==='paste'?500:400,transition:'all .1s'}}>Paste list</button>
          </div>
        </div>

        {inputMode==='structured'&&(
          <div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 28px',gap:'6px 8px',marginBottom:6}}>
              <div style={{fontSize:10,fontWeight:500,color:'var(--teal-400)',textTransform:'uppercase',letterSpacing:'.1em'}}>Company name</div>
              <div style={{fontSize:10,fontWeight:500,color:'var(--teal-400)',textTransform:'uppercase',letterSpacing:'.1em'}}>Website URL <span style={{color:'var(--camel-500)',fontWeight:400}}>(recommended)</span></div>
              <div/>
            </div>
            {entries.map((en,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 28px',gap:'6px 8px',marginBottom:6}}>
                <input type="text" placeholder="e.g. Sidara" value={en.name}
                  onChange={e=>{updateEntry(i,'name',e.target.value);setErrs(v=>({...v,co:undefined}))}}
                  className={errs.co&&!en.name.trim()?'err-i':''} style={{fontSize:13}}/>
                <input type="text" placeholder="e.g. sidara.com" value={en.url}
                  onChange={e=>updateEntry(i,'url',e.target.value)}
                  style={{fontSize:13}}/>
                <button onClick={()=>removeEntry(i)} style={{width:28,height:36,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'1px solid var(--cream-300)',borderRadius:'var(--r-sm)',cursor:'pointer',color:'var(--teal-400)',fontSize:15,flexShrink:0}} disabled={entries.length===1}>×</button>
              </div>
            ))}
            <button onClick={addEntry} style={{marginTop:4,fontSize:11,color:'var(--camel-500)',background:'none',border:'1px dashed var(--camel-300)',borderRadius:'var(--r-md)',padding:'6px 14px',cursor:'pointer',fontFamily:'var(--f-sans)',width:'100%',transition:'all .1s'}}>+ add another company</button>
            <div style={{marginTop:8,fontSize:11,color:'var(--teal-400)',fontStyle:'italic'}}>The website URL pins the resolution to the exact company — recommended for private, international, or ambiguously-named companies.</div>
          </div>
        )}

        {inputMode==='paste'&&(
          <div className="fwrap">
            <textarea placeholder={'Paste any format — numbered lists, tabs, commas, or one per line.\n\n1. Terabase Energy\n2. Lincoln Electric\n3. CBRE\n4. Generate Biomedicines\n5. TetraScience'} value={list} onChange={e=>{setList(e.target.value);setErrs(v=>({...v,co:undefined}))}} className={errs.co?'err-i':''} rows={8}/>
            <span className="fhint">Names and tickers only in paste mode. Switch to "Add by name + URL" for more accurate resolution of ambiguous or private companies.</span>
          </div>
        )}

        {errs.co&&<div className="err-msg" style={{marginTop:8}}>{errs.co}</div>}

        {cos.length>0&&inputMode==='paste'&&(
          <div className="pbox">
            <div className="phd"><span className="pct">{cos.length} {cos.length===1?'company':'companies'} parsed</span><button className="clr" onClick={()=>setList('')}>clear all</button></div>
            <div className="tags">{cos.map((c,i)=><span key={i} className="ctag"><span className="ttype">{c.type}</span>{c.value}</span>)}</div>
          </div>
        )}
      </div>
      <div className="csect">
        <div className="slbl">Signal themes</div>
        <div className="tgrid">
          {THEMES.map(t=>{const sel=themes.has(t.id);return(
            <button key={t.id} className="tchip" onClick={()=>{setThemes(prev=>{const n=new Set(prev);n.has(t.id)?n.delete(t.id):n.add(t.id);return n});setErrs(e=>({...e,th:undefined}))}} style={sel?{borderColor:t.color,background:t.color+'0D',boxShadow:`0 0 0 1px ${t.color}1A`}:{}}>
              <span className="tdot" style={{background:sel?t.color:undefined}}/><span className="tlbl" style={sel?{color:t.color,fontWeight:500}:{}}>{t.label}</span>
            </button>
          )})}
        </div>
        {errs.th&&<div className="err-msg" style={{marginTop:9}}>{errs.th}</div>}
      </div>
      <div className="csect">
        <div className="slbl">Defaults</div>
        <div className="drow">
          <div className="dbadge"><div className="dlbl">Market</div><div className="dval">United States</div></div>
          <div className="dbadge"><div className="dlbl">Intelligence mode</div><div className="dval">Claude AI — live research</div></div>
        </div>
      </div>
      <div className="csect">
        <div className="slbl">Enrichment</div>
        <div className="togrow">
          <div className="toginfo"><div className="togtitle">SAM.gov enrichment</div><div className="togdesc">Include federal contractor and public sector signals. Recommended for defence-adjacent or government-contract companies.</div></div>
          <label className="toggle"><input type="checkbox" checked={sam} onChange={e=>setSam(e.target.checked)}/><span className="ttrack"/></label>
        </div>
      </div>
      <div className="cfoot">
        <span className="fhint2">{cos.length} {cos.length===1?'company':'companies'} · {themes.size} {themes.size===1?'theme':'themes'} · est. {Math.round(cos.length*45/60)} min (sequential with rate limiting)</span>
        <button className="btn-camel" onClick={handleCreate} disabled={scanning}>{scanning?'creating scan…':'create scan →'}</button>
      </div>
    </div>
  )
}

/* ═══ F02 COMPANIES ═══ */
function CompaniesView({companies,hasScan}:{companies:ScannedCo[];hasScan:boolean}){
  const [xp,setXp]=useState<Set<string>>(new Set())
  if(!hasScan)return <Empty msg="Create a scan to see resolved companies."/>
  const toggle=(id:string)=>setXp(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n})
  const done=companies.filter(c=>c.status==='done').length
  return(
    <div style={{maxWidth:700}}>
      {done<companies.length&&<div className="info-amber">Researching {companies.length-done} of {companies.length} companies in real time…<div className="progwrap" style={{marginTop:8}}><div className="progfill" style={{width:`${companies.length>0?Math.round(done/companies.length*100):0}%`}}/></div></div>}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        {(['public','private','hybrid'] as const).map(t=>{const ct=companies.filter(c=>c.resolved?.track===t).length;return ct>0&&<Stat key={t} label={t} val={ct}/>})}
      </div>
      <div className="crows">
        {companies.map(co=>{
          const r=co.resolved,sc=co.score,isXp=xp.has(co.id)
          const trackCls=r?.track==='public'?'tp-pub':r?.track==='private'?'tp-priv':'tp-hyb'
          const gcls=sc?sc.grade==='A'?'ga':sc.grade==='B'?'gb':sc.grade==='C'?'gc2':'gd':''
          return(
            <div key={co.id}>
              <div className={`crow${isXp?' xp':''}`} onClick={()=>r&&toggle(co.id)}>
                <div style={{width:7,height:7,borderRadius:'50%',background:co.status==='done'?'var(--green)':co.status==='error'?'var(--red)':'var(--camel-500)',flexShrink:0}}/>
                <div className="cname">{r?.name||co.input.value}</div>
                {r&&<span className={`tpill ${trackCls}`}>{r.track}</span>}
                {r?.cik&&<span style={{fontSize:10,color:'var(--teal-400)',fontFamily:'var(--f-mono)'}}>{r.cik}</span>}
                {r?.formDFiled&&<span style={{fontSize:9,background:'var(--teal-50)',color:'var(--teal-600)',padding:'2px 6px',borderRadius:3,fontWeight:600,border:'1px solid var(--teal-100)'}}>Form D ✓</span>}
                {sc&&<div className={`gc ${gcls}`}>{sc.grade}</div>}
                {sc&&<div className="cscore" style={{color:scoreColor(sc.final)}}>{sc.final}</div>}
                {!r&&<span style={{fontSize:11,color:'var(--teal-400)',fontStyle:'italic'}}>{co.status==='error'?co.error:'researching…'}</span>}
                {r&&<span className="chv" style={{transform:isXp?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>}
              </div>
              {isXp&&r&&(
                <div className="crow-detail">
                  <div className="detail-grid">
                    {[['Track',r.track],['Stage',r.stage],r.cik?['CIK',r.cik]:null,r.ticker?['Ticker',r.ticker]:null,r.sic?['SIC',`${r.sic}${r.sicDesc?` · ${r.sicDesc}`:''}`]:null,r.hq?['HQ',r.hq]:null,r.employees?['Employees',r.employees]:null,r.website?['Website',r.website]:null,r.formDAmount?['Form D',r.formDAmount]:null,r.investors?['Investors',r.investors]:null,['Data quality',`${r.dataQuality} / 100`]].filter((x):x is [string,string]=>Array.isArray(x)).map(([k,v],i)=>(
                      <div key={i} className="detail-cell">
                        <div className="detail-key">{k}</div>
                        <div className="detail-val" style={{fontFamily:k==='CIK'||k==='Ticker'?'var(--f-mono)':'var(--f-sans)'}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="detail-note">{r.resolutionNote}</div>
                  {sc&&<div className="detail-rationale">{sc.scoringRationale}</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══ F04/F05 EVIDENCE ═══ */
function EvidenceView({companies,hasScan}:{companies:ScannedCo[];hasScan:boolean}){
  const [xp,setXp]=useState<Set<string>>(new Set())
  if(!hasScan)return <Empty msg="Create a scan to see evidence scores."/>
  const done=companies.filter(c=>c.status==='done')
  const toggle=(id:string)=>setXp(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n})
  const PW={signal_strength:.40,source_quality:.30,recency:.20,theme_coverage:.10}
  const PRIVW={regulatory:.35,technical:.25,operational:.20,market:.15,founder:.05}
  const PL:{[k:string]:string}={signal_strength:'Signal strength',source_quality:'Source quality',recency:'Recency',theme_coverage:'Theme coverage'}
  const PRIVL:{[k:string]:string}={regulatory:'Regulatory and legal',technical:'Technical and scientific',operational:'Operational momentum',market:'Market and capital',founder:'Founder and leadership'}
  return(
    <div style={{maxWidth:700}}>
      {done.length<companies.length&&<div className="info-amber">{companies.length-done.length} companies still being researched.</div>}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        {['Outreach ready','Outreach with caveats','Watch list'].map(r=>{const ct=done.filter(c=>c.score?.readiness===r).length;return ct>0&&<Stat key={r} label={r} val={ct}/>})}
      </div>
      <div className="crows">
        {companies.map((co,i)=>{
          const sc=co.score,sigs=co.signals||[]
          if(!sc)return(
            <div key={co.id} className="crow" style={{opacity:.5}}>
              <div style={{width:7,height:7,borderRadius:'50%',background:'var(--camel-500)'}}/>
              <div className="cname">{co.resolved?.name||co.input.value}</div>
              <span style={{fontSize:11,color:'var(--teal-400)',fontStyle:'italic'}}>{co.status==='error'?co.error:'researching…'}</span>
            </div>
          )
          const isXp=xp.has(co.id)
          const gcls=sc.grade==='A'?'ga':sc.grade==='B'?'gb':sc.grade==='C'?'gc2':'gd'
          const rbcls=sc.readiness==='Outreach ready'?'rb-r':sc.readiness==='Outreach with caveats'?'rb-c':'rb-w'
          const col=scoreColor(sc.final)
          const W=sc.model==='public'?PW:PRIVW
          const LBLS=sc.model==='public'?PL:PRIVL
          return(
            <div key={co.id}>
              <div className={`crow${isXp?' xp':''}`} onClick={()=>toggle(co.id)}>
                <div style={{fontSize:11,fontWeight:400,color:'var(--teal-400)',fontFamily:'var(--f-mono)',minWidth:18,textAlign:'center'}}>{i+1}</div>
                <div className="cname">{co.resolved?.name||co.input.value}</div>
                <span className={`rb ${rbcls}`}>{sc.readiness}</span>
                <div className={`gc ${gcls}`}>{sc.grade}</div>
                <div className="cscore" style={{color:col}}>{sc.final}</div>
                <span className="chv" style={{transform:isXp?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>
              </div>
              {isXp&&(
                <div className="crow-detail">
                  {sc.capped&&<div className="inf-note">Stage cap applied: raw {sc.raw} → final {sc.final} ({co.resolved?.stage} stage).</div>}
                  <div style={{fontSize:11,color:'rgba(248,242,232,.5)',fontStyle:'italic',lineHeight:1.5,marginBottom:10}}>{sc.scoringRationale}</div>
                  <div className="calcbox">
                    {Object.entries(W).map(([k,w])=><div key={k} className="calcrow"><span className="calk">{(LBLS as Record<string,string>)[k]||k} ({Math.round(w*100)}%)</span><span className="calv">{sc.dimensions[k]||0} × {w} = {Math.round((sc.dimensions[k]||0)*w)}</span></div>)}
                    <div className="calcrow"><span className="calk">high confidence bonus</span><span className="calv">+{sc.highConfBonus} → raw {sc.raw} → final {sc.final}</span></div>
                  </div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:11}}>
                    {THEMES.map(t=><span key={t.id} className={`ttag ${t.cls}`} style={!sc.themesHit.includes(t.id)?{opacity:.3}:{}}>{t.label}</span>)}
                  </div>
                  {sigs.length>0&&(
                    <>
                      <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'.14em',color:'var(--teal-400)',marginBottom:7}}>intelligence signals ({sigs.length})</div>
                      <div className="siglist">
                        {sigs.map((s,si)=>(
                          <div key={si} className="sigrow">
                            <span className="sdot" style={{background:TMAP[s.theme]?.color||'#888'}}/>
                            <div style={{flex:1,minWidth:0}}>
                              <div className="slbl2">{s.label}</div>
                              <div className="smeta">{s.excerpt}</div>
                              {s.sourceTypes?.length>0&&<div style={{fontSize:10,color:'var(--teal-300)',marginTop:3}}>Sources: {s.sourceTypes.join(', ')}</div>}
                            </div>
                            <div style={{display:'flex',flexDirection:'column',gap:2,alignItems:'flex-end',flexShrink:0}}>
                              <span className={`tierb ${tierCls(s.recencyTier)}`}>{tierLbl(s.recencyTier)}</span>
                              <span className={`confb ${confCls(s.confidence)}`}>{s.confidence}{s.confidenceCapped?' ↓':''}</span>
                            </div>
                            <div className="sadj">{s.adjStrength}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══ F07 STAKEHOLDERS ═══ */
function RolesView({companies,onMapRoles,hasScan}:{companies:ScannedCo[];onMapRoles:(id:string)=>Promise<void>;hasScan:boolean}){
  const [selCo,setSelCo]=useState<string|null>(null)
  const [xp,setXp]=useState<Set<string>>(new Set())
  const [loading,setLoading]=useState<Set<string>>(new Set())
  if(!hasScan)return <Empty msg="Create a scan first to map stakeholders."/>
  const scored=companies.filter(c=>c.status==='done'&&(c.score?.final||0)>=45)
  const activeCo=scored.find(c=>c.id===selCo)||scored[0]
  const handleMap=async(id:string)=>{setLoading(p=>{const n=new Set(p);n.add(id);return n});await onMapRoles(id);setLoading(p=>{const n=new Set(p);n.delete(id);return n})}
  const toggleRole=(k:string)=>setXp(p=>{const n=new Set(p);n.has(k)?n.delete(k):n.add(k);return n})
  return(
    <div style={{display:'flex',gap:18,maxWidth:920,flexWrap:'wrap'}}>
      <div style={{width:195,flexShrink:0}}>
        <div className="slbl" style={{marginBottom:8}}>Select company</div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {scored.map(co=>{
            const isA=activeCo?.id===co.id
            return(
              <button key={co.id} onClick={()=>setSelCo(co.id)} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:'var(--r-md)',border:isA?'1px solid var(--camel-400)':'1px solid var(--cream-300)',background:isA?'var(--camel-100)':'var(--cream-50)',cursor:'pointer',textAlign:'left',transition:'all .1s',width:'100%'}}>
                <div style={{fontSize:12,fontWeight:400,color:'var(--teal-800)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(co.resolved?.name||co.input.value).split(' ').slice(0,2).join(' ')}</div>
                <div style={{fontSize:11,fontFamily:'var(--f-mono)',color:isA?'var(--camel-600)':'var(--teal-400)',flexShrink:0}}>{co.score?.final}</div>
              </button>
            )
          })}
        </div>
      </div>
      <div style={{flex:1,minWidth:300}}>
        {activeCo&&(
          <>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
              <h2 style={{fontSize:17,fontWeight:400,color:'var(--teal-800)',flex:1,letterSpacing:'.01em'}}>{activeCo.resolved?.name||activeCo.input.value}</h2>
              {!activeCo.roles&&!loading.has(activeCo.id)&&<button className="btn-camel" style={{padding:'7px 16px',fontSize:12}} onClick={()=>handleMap(activeCo.id)}>map stakeholders →</button>}
              {loading.has(activeCo.id)&&<span style={{fontSize:12,color:'var(--teal-400)',fontStyle:'italic'}}>generating…</span>}
            </div>
            {!activeCo.roles&&!loading.has(activeCo.id)&&<div style={{background:'var(--cream-100)',border:'1px solid var(--cream-200)',borderRadius:'var(--r-lg)',padding:'20px',fontSize:13,color:'var(--teal-400)',fontStyle:'italic',fontWeight:300}}>Click "map stakeholders" to generate evidence-grounded role recommendations for {activeCo.resolved?.name||activeCo.input.value}.</div>}
            {activeCo.roles?.map((r,i)=>{
              const key=`${activeCo.id}-${i}`,isXp=xp.has(key)
              const actCls=ACT_CLS[r.action]||'act-c',actLbl=ACT_LABELS[r.action]||r.actionLabel||r.action
              const priCls=r.priority==='primary'?'b-pri':r.priority==='secondary'?'b-sec':'b-ter'
              const col=r.score>=75?'var(--green)':r.score>=55?'var(--amber)':'var(--red)'
              return(
                <div key={key} className={`rcard${r.priority==='primary'?' pri':''}`}>
                  <div className="rhead" onClick={()=>toggleRole(key)}>
                    <div className="rtcol">
                      <div className="rtitle">{r.title}</div>
                      <div className="brow"><span className={`badge ${priCls}`}>{r.priority.charAt(0).toUpperCase()+r.priority.slice(1)}</span><span className={`badge ${actCls}`}>{actLbl}</span></div>
                    </div>
                    <div className="rscore" style={{color:col}}>{r.score}</div>
                    <span className="chv" style={{transform:isXp?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>
                  </div>
                  {isXp&&(
                    <div className="rdetail open">
                      {r.inferenceNote&&<div className="inf-note">{r.inferenceNote}</div>}
                      <div className="rsec"><div className="rslbl">Why this role matters</div><div className="rtxt">{r.whyMatters}</div></div>
                      <div className="rsec"><div className="rslbl">How to use this contact</div><div className="rtxt">{r.howToUse}</div></div>
                      <div className="crgrid">
                        <div className="crcard"><div className="crlbl">Evidence confidence</div><div className={`crval ch-${r.evidenceConf.toLowerCase()}`}>{r.evidenceConf}</div><div className="crnote">{r.evidenceConfNote}</div></div>
                        <div className="crcard"><div className="crlbl">Inference risk</div><div className={`crval ri-${r.inferenceRisk.toLowerCase()}`}>{r.inferenceRisk}</div><div className="crnote">{r.inferenceRiskNote}</div></div>
                      </div>
                      <div className="rsec">
                        <div className="rslbl">Cold call topic menu</div>
                        <div className="topiclist">
                          {r.topics.map((t,ti)=><div key={ti} className="topicitem"><span className="tnum">{ti+1}</span><span className="ttxt">{t.text}</span><span className={`ttag2 ${t.tag==='evidence'?'t-ev':t.tag==='inferred'?'t-inf':'t-spec'}`}>{t.tag}</span></div>)}
                        </div>
                      </div>
                      <div className="rsec"><div className="rslbl">Suggested first question</div><div className="firstq">{r.firstQuestion}</div></div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

/* ═══ F08/09 OUTREACH ═══ */
function OutreachView({companies,liDrafts,emailDrafts,angles,onBuildAngle,onDraftLI,onDraftEmail,hasScan}:{companies:ScannedCo[];liDrafts:Record<string,string>;emailDrafts:Record<string,EmailDraft>;angles:Record<string,Angle>;onBuildAngle:(coId:string,ri:number)=>Promise<void>;onDraftLI:(coId:string,ri:number,tone:string)=>Promise<void>;onDraftEmail:(coId:string,ri:number,tone:string)=>Promise<void>;hasScan:boolean}){
  const [selCo,setSelCo]=useState<string|null>(null);const [selRole,setSelRole]=useState(0);const [tab,setTab]=useState<'li'|'email'>('li');const [tone,setTone]=useState('consultative');const [loading,setLoading]=useState(false);const [loadingAngle,setLoadingAngle]=useState(false)
  if(!hasScan)return <Empty msg="Create a scan and map stakeholders to draft outreach."/>
  const cos=companies.filter(c=>c.roles&&c.roles.length>0)
  if(cos.length===0)return <Empty msg="Map stakeholders first — go to the Stakeholders tab."/>
  const activeCo=cos.find(c=>c.id===selCo)||cos[0]
  const activeRoles=activeCo?.roles||[]
  const activeRole=activeRoles[selRole]
  const dk=`${activeCo?.id}-${selRole}-${tone}`,ak=`${activeCo?.id}-${selRole}`
  const liDraft=liDrafts[dk],emailDraft=emailDrafts[dk],activeAngle=angles[ak]
  const liLen=liDraft?14+liDraft.length:0
  const hasDash=(s:string)=>/[-\u2013\u2014]/.test(s)
  const handleAngle=async()=>{if(!activeCo)return;setLoadingAngle(true);await onBuildAngle(activeCo.id,selRole);setLoadingAngle(false)}
  const handleGen=async()=>{if(!activeCo)return;setLoading(true);if(tab==='li')await onDraftLI(activeCo.id,selRole,tone);else await onDraftEmail(activeCo.id,selRole,tone);setLoading(false)}
  const copy=(txt:string,btn:HTMLButtonElement)=>{navigator.clipboard.writeText(txt).then(()=>{btn.textContent='copied';btn.classList.add('copied');setTimeout(()=>{btn.textContent='copy';btn.classList.remove('copied')},2000)})}
  return(
    <div style={{display:'flex',gap:18,maxWidth:940,flexWrap:'wrap'}}>
      <div style={{width:195,flexShrink:0}}>
        <div className="slbl" style={{marginBottom:8}}>Company</div>
        <div style={{display:'flex',flexDirection:'column',gap:3,marginBottom:16}}>
          {cos.map(co=>{const isA=activeCo?.id===co.id;return<button key={co.id} onClick={()=>{setSelCo(co.id);setSelRole(0)}} style={{padding:'8px 12px',borderRadius:'var(--r-md)',border:isA?'1px solid var(--camel-400)':'1px solid var(--cream-300)',background:isA?'var(--camel-100)':'var(--cream-50)',cursor:'pointer',textAlign:'left',fontSize:12,fontWeight:400,color:'var(--teal-800)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',transition:'all .1s',width:'100%'}}>{(co.resolved?.name||co.input.value).split(' ').slice(0,2).join(' ')}</button>})}
        </div>
        {activeRoles.length>0&&<>
          <div className="slbl" style={{marginBottom:8}}>Role</div>
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            {activeRoles.map((r,i)=><button key={i} onClick={()=>setSelRole(i)} style={{padding:'8px 12px',borderRadius:'var(--r-md)',border:selRole===i?'1px solid var(--camel-400)':'1px solid var(--cream-300)',background:selRole===i?'var(--camel-100)':'var(--cream-50)',cursor:'pointer',textAlign:'left',fontSize:11,lineHeight:1.4,transition:'all .1s',width:'100%'}}><div style={{fontWeight:400,color:'var(--teal-800)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title.split('/')[0].trim()}</div><div style={{fontSize:10,color:'var(--teal-400)',marginTop:2}}>{ACT_LABELS[r.action]||r.actionLabel}</div></button>)}
          </div>
        </>}
      </div>
      <div style={{flex:1,minWidth:300}}>
        {activeCo&&activeRole&&<>
          <div style={{marginBottom:14}}><h3 style={{fontSize:15,fontWeight:400,color:'var(--teal-800)',marginBottom:3}}>{activeRole.title}</h3><div style={{fontSize:12,color:'var(--teal-400)'}}>{activeCo.resolved?.name||activeCo.input.value}</div></div>
          {!activeAngle&&<div style={{background:'var(--cream-100)',border:'1px solid var(--cream-300)',borderRadius:'var(--r-md)',padding:'13px 15px',marginBottom:13}}><div style={{fontSize:12,color:'var(--teal-400)',fontStyle:'italic',marginBottom:9}}>Build an evidence-grounded outreach angle before drafting for best results.</div><button className="btn-ghost-camel" style={{fontSize:11}} onClick={handleAngle} disabled={loadingAngle}>{loadingAngle?'building…':'build outreach angle →'}</button></div>}
          {activeAngle&&<div className="angle-card"><div className="slbl">outreach angle</div><div className="angle-hypothesis">{activeAngle.hypothesis}</div><div className="angle-trigger">Trigger: {activeAngle.triggerEvent}</div><div className="angle-approach">{activeAngle.approachRationale}</div></div>}
          <div className="dtabs"><button className={`dtab${tab==='li'?' on':''}`} onClick={()=>setTab('li')}>LinkedIn connect</button><button className={`dtab${tab==='email'?' on':''}`} onClick={()=>setTab('email')}>First-touch email</button></div>
          <div className="tonerow"><span className="tonelbl">Tone:</span>{['consultative','direct','challenger'].map(t=><button key={t} className={`tonebtn${tone===t?' on':''}`} onClick={()=>setTone(t)}>{t}</button>)}</div>
          {tab==='li'&&<>
            <div className="slbl" style={{marginBottom:8}}>LinkedIn connection message · 300 character limit</div>
            <div className="limock">
              <div className="limh"><div className="liav">{activeRole.title[0].toUpperCase()}</div><div><div className="linm">{activeRole.title}</div><div className="lirol">{activeCo.resolved?.name||activeCo.input.value}</div></div></div>
              {liDraft?<><div className="msgbox"><span className="nameph">[First name], </span>{liDraft}</div><div className="charrow"><div className="charbg"><div className="charfill" style={{width:`${Math.min(liLen/300*100,100)}%`,background:liLen>300?'var(--red)':'var(--green)'}}/></div><span className={`charnum ${liLen>300?'cn-ov':liLen>280?'cn-w':'cn-ok'}`}>{liLen} / 300</span><span style={{fontSize:10,color:'var(--teal-400)'}}>(14 reserved)</span></div>{hasDash(liDraft)&&<div className="dwarn" style={{display:'block'}}>contains a dash — regenerate to fix</div>}</> : <div className="msgbox empty">select tone and generate your LinkedIn message.</div>}
            </div>
            <div className="btnrow"><button className="btn" onClick={handleGen} disabled={loading}>{loading?'generating…':liDraft?'regenerate →':'generate →'}</button>{liDraft&&<button className="btn-sm" onClick={e=>copy('[First name], '+liDraft,e.currentTarget)}>copy</button>}</div>
          </>}
          {tab==='email'&&<>
            <div className="slbl" style={{marginBottom:8}}>First-touch email</div>
            <div className="emock">
              <div style={{marginBottom:10}}><div className="emrow"><span className="emlbl">To:</span><span className="emval">{activeRole.title}</span></div><div className="emrow"><span className="emlbl">Subject:</span><span className="emval">{emailDraft?.subject||'—'}</span></div></div>
              {emailDraft?<><div className="ebody">{emailDraft.body}</div>{hasDash(emailDraft.body)&&<div className="dwarn" style={{display:'block'}}>contains a dash — regenerate to fix</div>}</> : <div className="ebody empty">select tone and generate your first-touch email.</div>}
            </div>
            <div className="btnrow"><button className="btn" onClick={handleGen} disabled={loading}>{loading?'generating…':emailDraft?'regenerate →':'generate →'}</button>{emailDraft&&<button className="btn-sm" onClick={e=>copy(`Subject: ${emailDraft.subject}\n\n${emailDraft.body}`,e.currentTarget)}>copy</button>}</div>
          </>}
        </>}
      </div>
    </div>
  )
}

/* ═══ F10 EXPORT ═══ */
function ExportView({companies,liDrafts,emailDrafts,hasScan}:{companies:ScannedCo[];liDrafts:Record<string,string>;emailDrafts:Record<string,EmailDraft>;hasScan:boolean}){
  if(!hasScan)return <Empty msg="Create a scan to generate account summaries."/>
  const done=companies.filter(c=>c.status==='done')
  function build(co:ScannedCo):string{
    const r=co.resolved,sc=co.score,sigs=co.signals||[],roles=co.roles||[]
    const L:string[]=[]
    L.push('cream — account intelligence');L.push(`generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`);L.push('')
    L.push(`company: ${r?.name||co.input.value}`)
    if(r){L.push(`track: ${r.track} · stage: ${r.stage}`);if(r.cik)L.push(`cik: ${r.cik}`);if(r.ticker)L.push(`ticker: ${r.ticker}`);if(r.hq)L.push(`hq: ${r.hq}`);if(r.employees)L.push(`employees: ${r.employees}`)}
    if(sc){L.push(`score: ${sc.final}/100 · grade: ${sc.grade} · ${sc.readiness}`);L.push(`rationale: ${sc.scoringRationale}`)}
    L.push('')
    if(sigs.length){L.push('intelligence signals');sigs.forEach((s,i)=>{L.push(`${i+1}. [${s.theme}] ${s.label}`);L.push(`   score: ${s.adjStrength} · ${s.recencyTier} · ${s.sourceType} · ${s.confidence} confidence`);L.push(`   ${s.excerpt}`);if(s.sourceTypes?.length)L.push(`   sources: ${s.sourceTypes.join(', ')}`)});L.push('')}
    if(roles.length){L.push('stakeholder roles');roles.forEach((role,i)=>{L.push(`${i+1}. ${role.title}`);L.push(`   action: ${ACT_LABELS[role.action]||role.actionLabel} · score: ${role.score} · confidence: ${role.evidenceConf} · risk: ${role.inferenceRisk}`);L.push(`   ${role.whyMatters}`);L.push('   topics:');role.topics.forEach((t,ti)=>L.push(`   ${ti+1}. ${t.text} [${t.tag}]`));L.push(`   first question: ${role.firstQuestion}`);L.push('')})}
    const liKey=Object.keys(liDrafts).find(k=>k.startsWith(co.id))
    const emKey=Object.keys(emailDrafts).find(k=>k.startsWith(co.id))
    if(liKey&&liDrafts[liKey]){L.push('linkedin');L.push(`[First name], ${liDrafts[liKey]}`);L.push('')}
    if(emKey&&emailDrafts[emKey]){L.push('email');L.push(`subject: ${emailDrafts[emKey].subject}`);L.push('');L.push(emailDrafts[emKey].body)}
    return L.join('\n')
  }
  function download(co:ScannedCo){const txt=build(co),blob=new Blob([txt],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${(co.resolved?.name||co.input.value).replace(/\s+/g,'_')}_cream_${new Date().toISOString().slice(0,10)}.txt`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url)}
  return(
    <div className="excard">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
        <h2 style={{fontSize:18,fontWeight:300,color:'var(--teal-800)',letterSpacing:'.01em'}}>account summaries</h2>
        <button className="btn-ghost" onClick={()=>{const all=done.map(build).join('\n\n'+'─'.repeat(60)+'\n\n');navigator.clipboard.writeText(all)}}>copy all</button>
      </div>
      {done.length===0&&<div style={{fontSize:13,color:'var(--teal-400)',fontStyle:'italic'}}>No completed companies yet.</div>}
      {done.map(co=>{
        const sc=co.score,gcls=sc?sc.grade==='A'?'ga':sc.grade==='B'?'gb':sc.grade==='C'?'gc2':'gd':''
        const hasR=!!(co.roles?.length),hasLI=Object.keys(liDrafts).some(k=>k.startsWith(co.id)),hasEM=Object.keys(emailDrafts).some(k=>k.startsWith(co.id))
        return(
          <div key={co.id} className="exco">
            {sc&&<div className={`gc ${gcls}`}>{sc.grade}</div>}
            <div className="exname">{co.resolved?.name||co.input.value}</div>
            {sc&&<span style={{fontSize:12,fontFamily:'var(--f-mono)',color:'var(--teal-400)'}}>{sc.final}</span>}
            <div style={{display:'flex',gap:4}}>
              {hasR&&<span style={{fontSize:9,background:'var(--green-bg)',color:'var(--green)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>roles</span>}
              {hasLI&&<span style={{fontSize:9,background:'var(--teal-50)',color:'var(--teal-600)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>li</span>}
              {hasEM&&<span style={{fontSize:9,background:'var(--camel-100)',color:'var(--camel-600)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>email</span>}
            </div>
            <button className="btn-sm" onClick={e=>{navigator.clipboard.writeText(build(co));const b=e.currentTarget;b.textContent='copied';b.classList.add('copied');setTimeout(()=>{b.textContent='copy';b.classList.remove('copied')},2000)}}>copy</button>
            <button className="btn-sm" onClick={()=>download(co)}>download</button>
          </div>
        )
      })}
      <div style={{marginTop:16,padding:'12px 14px',background:'var(--cream-100)',border:'1px solid var(--cream-200)',borderRadius:'var(--r-md)',fontSize:12,color:'var(--teal-400)',fontStyle:'italic',lineHeight:1.6}}>Each summary includes resolution details, intelligence signals with source citations, scoring rationale, stakeholder roles with cold call topics, and outreach drafts in plain text ready for CRM or briefing documents.</div>
    </div>
  )
}

/* ═══ SHARED ═══ */
function Empty({msg}:{msg:string}){return <div className="empty-st"><div className="empty-ico">c</div><div className="empty-txt">{msg}</div></div>}
function Stat({label,val}:{label:string;val:number}){return <div className="statcard"><div className="stat-lbl">{label}</div><div className="stat-val" style={{color:'var(--teal-800)'}}>{val}</div></div>}
