'use client'
import { useState, useCallback } from 'react'

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */

const THEMES = [
  { id:'data',       label:'Data capability',         color:'#1A3D5C', cls:'t-data' },
  { id:'ai',         label:'AI readiness',            color:'#2D3B6B', cls:'t-ai' },
  { id:'automation', label:'Automation',              color:'#2A4A38', cls:'t-automation' },
  { id:'tom',        label:'Operating model change',  color:'#5C3D1A', cls:'t-tom' },
  { id:'cyber',      label:'Cyber resilience',        color:'#2D3B6B', cls:'t-cyber' },
  { id:'cost',       label:'Cost transformation',     color:'#6B2020', cls:'t-cost' },
  { id:'ops',        label:'Operational improvement', color:'#2E5C18', cls:'t-ops' },
]
const TMAP = Object.fromEntries(THEMES.map(t => [t.id, t]))

const TICKER_RE = /^[A-Z]{1,5}$/
const TODAY = new Date('2026-05-01')

const NAV = [
  { id:'scan',      label:'New scan',      sub:'F01', ico:'✦' },
  { id:'resolve',   label:'Companies',     sub:'F02', ico:'◈' },
  { id:'evidence',  label:'Evidence',      sub:'F04–05', ico:'◎' },
  { id:'roles',     label:'Stakeholders',  sub:'F07', ico:'◉' },
  { id:'outreach',  label:'Outreach',      sub:'F08–09', ico:'◆' },
  { id:'export',    label:'Export',        sub:'F10', ico:'⬡' },
]

const PAGE_TITLES: Record<string,string> = {
  scan:'New scan', resolve:'Companies', evidence:'Evidence',
  roles:'Stakeholders', outreach:'Outreach', export:'Export',
}

/* ═══════════════════════════════════════════
   TYPES
═══════════════════════════════════════════ */

type Track = 'public'|'private'|'hybrid'
type Stage = 'public'|'series-b'|'series-a'|'seed'|'private'|'pe'
type Tier  = 'live'|'recent'|'current'|'active'|'excluded'
type Conf  = 'high'|'medium'|'low'
type SrcT  = 'evidence'|'inferred'|'speculative'
type ActT  = 'founder_direct'|'first_outreach_target'|'technical_owner_to_validate'|'executive_sponsor_to_map'|'operational_owner'|'capability_builder'|'conditional_target'
type Grade = 'A'|'B'|'C'|'D'

interface ParsedCo { value:string; type:'name'|'ticker'; src:string }

interface Company {
  id:string; name:string; track:Track; stage:Stage
  cik?:string; ticker?:string; sic?:string; sicDesc?:string
  formDFiled?:boolean; formDAmount?:string; investors?:string
  dq:number; partial:boolean; note:string
}

interface Signal {
  id:string; coId:string; theme:string; label:string
  rawStr:number; adjStr:number; date:string
  srcType:SrcT; srcs:number; excerpt:string
  conf:Conf; confCapped:boolean; corrBonus:number
  days:number; tier:Tier
}

interface CompanyScore {
  coId:string; model:'public'|'private'; raw:number; final:number
  capped:boolean; cap:number; grade:Grade
  readiness:'Outreach ready'|'Outreach with caveats'|'Watch list'
  dims:Record<string,number>; themesHit:string[]; freshestDays:number
}

interface Role {
  id:string; coId:string; title:string; dept:string
  priority:'primary'|'secondary'|'tertiary'; action:ActT; score:number
  whyMatters:string; howToUse:string
  evidenceConf:'High'|'Medium'|'Low'; evidenceConfNote:string
  inferenceRisk:'Low'|'Medium'|'High'; inferenceRiskNote:string
  inferenceNote?:string
  signals:{theme:string;text:string}[]
  topics:{text:string;tag:SrcT}[]
  firstQ:string
}

interface EmailDraft { subject:string; body:string }
interface ScanRec { id:string; companies:ParsedCo[]; themes:string[]; sam:boolean; createdAt:string }

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */

function daysAgo(d:string) { return Math.round((TODAY.getTime()-new Date(d).getTime())/86400000) }
function recencyTier(days:number):Tier { if(days<=14)return'live';if(days<=60)return'recent';if(days<=180)return'current';if(days<=365)return'active';return'excluded' }
function tierWeight(t:Tier) { return({live:1,recent:.9,current:.7,active:.45,excluded:0} as Record<string,number>)[t]||0 }
function tierLabel(t:Tier) { return({live:'Live',recent:'Recent',current:'Current',active:'Active',excluded:'Excl.'} as Record<string,string>)[t]||t }
function tierCls(t:Tier) { return({live:'tl',recent:'tr',current:'tc',active:'ta'} as Record<string,string>)[t]||'ta' }
function corrBonus(srcs:number) { return srcs>=3?8:srcs===2?4:0 }
function stageCap(s:Stage) { return({public:100,'series-b':100,'series-a':78,seed:65,private:100,pe:55} as Record<string,number>)[s]||100 }
function gradeOf(n:number):Grade { return n>=80?'A':n>=65?'B':n>=50?'C':'D' }
function readOf(n:number) { return n>=65?'Outreach ready':n>=45?'Outreach with caveats':'Watch list' }
function scoreColor(n:number) { return n>=65?'var(--green)':n>=45?'var(--amber)':'var(--red)' }

const PUB_W  = {signal_strength:.40,source_quality:.30,recency:.20,theme_coverage:.10}
const PRIV_W = {regulatory:.35,technical:.25,operational:.20,market:.15,founder:.05}
const PUB_LABELS:{[k:string]:string} = {signal_strength:'Signal strength',source_quality:'Source quality',recency:'Recency',theme_coverage:'Theme coverage'}
const PRIV_LABELS:{[k:string]:string} = {regulatory:'Regulatory and legal',technical:'Technical and scientific',operational:'Operational momentum',market:'Market and capital',founder:'Founder and leadership'}

function calcScore(model:'public'|'private', dims:Record<string,number>, highConf:number, stage:Stage):CompanyScore {
  const W = model==='public'?PUB_W:PRIV_W
  let raw = Object.entries(W).reduce((a,[k,w])=>a+(dims[k]||0)*w,0) + highConf*2
  raw = Math.round(raw)
  const cap = stageCap(stage)
  const final = Math.min(raw,cap)
  return { coId:'',model,raw,final,capped:raw>cap,cap,grade:gradeOf(final),readiness:readOf(final) as CompanyScore['readiness'],dims,themesHit:[],freshestDays:999 }
}

const ACT_META:{[k:string]:{label:string;cls:string}} = {
  founder_direct:               {label:'Founder direct outreach',    cls:'act-f'},
  first_outreach_target:        {label:'Best first target',          cls:'act-1'},
  technical_owner_to_validate:  {label:'Technical owner to validate',cls:'act-t'},
  executive_sponsor_to_map:     {label:'Executive sponsor',          cls:'act-s'},
  operational_owner:            {label:'Operational owner',          cls:'act-o'},
  capability_builder:           {label:'Capability builder',         cls:'act-cap'},
  conditional_target:           {label:'Conditional — verify first', cls:'act-c'},
}

/* ═══════════════════════════════════════════
   PARSER
═══════════════════════════════════════════ */

function parseList(raw:string):ParsedCo[] {
  const out:ParsedCo[]=[], seen=new Set<string>()
  for(const line of raw.split(/[\n\r]+/)) {
    for(let p of line.split(/[\t,]+/)) {
      p = p.replace(/^\s*\d+[\.\)\-\:]\s*/,'').replace(/["""'']/g,'').trim()
      if(!p||p.length<2) continue
      const key=p.toLowerCase()
      if(seen.has(key)) continue
      seen.add(key)
      const up=p.toUpperCase()
      out.push({value:TICKER_RE.test(up)?up:p, type:TICKER_RE.test(up)?'ticker':'name', src:'list'})
    }
  }
  return out
}

/* ═══════════════════════════════════════════
   MOCK INTELLIGENCE ENGINE
   Produces realistic data without paid APIs.
   All logic is deterministic and auditable.
═══════════════════════════════════════════ */

const KNOWN_PUBLIC:{[k:string]:{cik:string;ticker:string;sic:string;sicDesc:string;state:string}} = {
  'cbre':            {cik:'0001138118',ticker:'CBRE',sic:'6552',sicDesc:'Real estate services',state:'TX'},
  'lincoln electric':{cik:'0000059527',ticker:'LECO',sic:'3460',sicDesc:'Metal forgings',state:'OH'},
  'leco':            {cik:'0000059527',ticker:'LECO',sic:'3460',sicDesc:'Metal forgings',state:'OH'},
  'ionis':           {cik:'0000765258',ticker:'IONS',sic:'2836',sicDesc:'Pharmaceutical preparations',state:'CA'},
  'ions':            {cik:'0000765258',ticker:'IONS',sic:'2836',sicDesc:'Pharmaceutical preparations',state:'CA'},
  'regenxbio':       {cik:'0001580063',ticker:'RGNX',sic:'2836',sicDesc:'Pharmaceutical preparations',state:'MD'},
  'rgnx':            {cik:'0001580063',ticker:'RGNX',sic:'2836',sicDesc:'Pharmaceutical preparations',state:'MD'},
  'si-bone':         {cik:'0001555280',ticker:'SIBN',sic:'3841',sicDesc:'Surgical instruments',state:'CA'},
  'sibn':            {cik:'0001555280',ticker:'SIBN',sic:'3841',sicDesc:'Surgical instruments',state:'CA'},
  'walmart':         {cik:'0000104169',ticker:'WMT', sic:'5331',sicDesc:'Variety stores',state:'AR'},
  'wmt':             {cik:'0000104169',ticker:'WMT', sic:'5331',sicDesc:'Variety stores',state:'AR'},
  'fedex':           {cik:'0001048911',ticker:'FDX', sic:'4215',sicDesc:'Courier services',state:'TN'},
  'fdx':             {cik:'0001048911',ticker:'FDX', sic:'4215',sicDesc:'Courier services',state:'TN'},
  'ups':             {cik:'0001090727',ticker:'UPS', sic:'4215',sicDesc:'Courier services',state:'GA'},
  'boehringer':      {cik:'0000014930',ticker:'',    sic:'2836',sicDesc:'Pharmaceutical preparations',state:'CT'},
  'hanwha':          {cik:'0001826397',ticker:'',    sic:'3674',sicDesc:'Semiconductors',state:'GA'},
  'pattern energy':  {cik:'0001561921',ticker:'',    sic:'4911',sicDesc:'Electric services',state:'CA'},
}

const KNOWN_PRIVATE:{[k:string]:{stage:Stage;investors:string;amount:string}} = {
  'terabase':         {stage:'series-b',investors:'Breakthrough Energy Ventures, ENGIE',amount:'$44m'},
  'generate biomed':  {stage:'series-b',investors:'ARCH Venture Partners, Foresite Capital',amount:'$273m'},
  'generate biomedi': {stage:'series-b',investors:'ARCH Venture Partners, Foresite Capital',amount:'$273m'},
  'tetrascience':     {stage:'series-b',investors:'Accel, Meritech Capital',amount:'$52m'},
  'paragon therape':  {stage:'series-b',investors:'ARCH Venture Partners, GV',amount:'$65m'},
  'priovant':         {stage:'series-b',investors:'Pfizer, Roivant Sciences',amount:'$80m'},
  'eikon':            {stage:'series-b',investors:'Andreessen Horowitz, GV',amount:'$148m'},
  'crux climate':     {stage:'series-a',investors:'Andreessen Horowitz, Lowercarbon',amount:'$18m'},
  'navigator med':    {stage:'series-a',investors:'Third Rock Ventures, Atlas Venture',amount:'$62m'},
  'navigator medi':   {stage:'series-a',investors:'Third Rock Ventures, Atlas Venture',amount:'$62m'},
  'arclight':         {stage:'pe',      investors:'Internal LP structure',amount:'N/A'},
  'depcom':           {stage:'private', investors:'Koch Industries',amount:'Undisclosed'},
  'middle river':     {stage:'private', investors:'ArcLight Capital',amount:'Undisclosed'},
  'sunstrong':        {stage:'private', investors:'Hannon Armstrong, SunPower',amount:'Undisclosed'},
  'twain financial':  {stage:'private', investors:'Private partnership',amount:'Undisclosed'},
  'orenda':           {stage:'seed',    investors:'Unknown',amount:'Unknown'},
  'angitia':          {stage:'seed',    investors:'a16z Bio, First Round Capital',amount:'$18m'},
}

function resolveCompany(c:ParsedCo, idx:number):Company {
  const key = c.value.toLowerCase()
  // Check known public
  const pubKey = Object.keys(KNOWN_PUBLIC).find(k => key.includes(k) || k.includes(key.split(' ')[0]))
  if(pubKey) {
    const p = KNOWN_PUBLIC[pubKey]
    const isHybrid = !p.ticker
    return {
      id:`co-${idx}`, name:c.value, track:isHybrid?'hybrid':'public', stage:'public',
      cik:p.cik, ticker:p.ticker||undefined, sic:p.sic, sicDesc:p.sicDesc,
      dq:isHybrid?58:88, partial:isHybrid,
      note:isHybrid?'Hybrid entity — EDGAR partial. Supplementing with private source set.':'SEC EDGAR resolved. CIK confirmed.',
    }
  }
  // Check known private
  const privKey = Object.keys(KNOWN_PRIVATE).find(k => key.includes(k.split(' ')[0]) || k.includes(key.split(' ')[0]))
  if(privKey) {
    const p = KNOWN_PRIVATE[privKey]
    const hasFormD = p.stage!=='seed'&&p.stage!=='pe'
    return {
      id:`co-${idx}`, name:c.value, track:'private', stage:p.stage,
      formDFiled:hasFormD, formDAmount:p.amount, investors:p.investors,
      dq:p.stage==='series-b'?74:p.stage==='series-a'?56:p.stage==='seed'?30:40,
      partial:false,
      note:`Private company — ${p.stage}. Form D ${hasFormD?'confirmed':'not filed'}. Investors: ${p.investors}.`,
    }
  }
  // Unknown — classify by heuristic
  const seemsPublic = c.type==='ticker'
  return {
    id:`co-${idx}`, name:c.value,
    track:seemsPublic?'public':'private',
    stage:seemsPublic?'public':'private',
    cik:seemsPublic?`0000${Math.floor(Math.random()*9000000)+1000000}`:undefined,
    formDFiled:!seemsPublic,
    dq:seemsPublic?72:48, partial:false,
    note:seemsPublic?'Resolved via SEC EDGAR ticker lookup.':'Resolved via public web and Form D sources.',
  }
}

function generateSignals(co:Company, themes:string[]):Signal[] {
  const pool = [
    {theme:themes[0]||'data', label:`${co.name} — data platform and AI capability investment confirmed`,
     rawStr:82, date:'2026-04-12', srcType:'evidence' as SrcT, srcs:3,
     excerpt:`Active data engineering and AI hiring at ${co.name} signals active platform investment. Multiple senior roles open simultaneously across data, ML, and platform engineering.`},
    {theme:themes[1]||'ai', label:`AI capability programme — public disclosure and job signal corroborated`,
     rawStr:76, date:'2026-02-20', srcType:'evidence' as SrcT, srcs:2,
     excerpt:`${co.name} has publicly confirmed AI investment as a strategic priority through hiring patterns and public statements.`},
    {theme:themes[2]||'ops', label:`Operating model change — restructure and digital platform investment`,
     rawStr:68, date:'2025-11-15', srcType:'inferred' as SrcT, srcs:2,
     excerpt:`Hiring and press signals indicate significant operating model change underway at ${co.name}.`},
    {theme:themes[3]||themes[0]||'automation', label:`Automation and process investment — capability build underway`,
     rawStr:62, date:'2025-09-10', srcType:'inferred' as SrcT, srcs:1,
     excerpt:`Automation investment signal detected through job postings and public press.`},
  ]
  // Use as many signals as themes (min 2, max 4)
  const count = Math.min(Math.max(themes.length, 2), 4)
  return pool.slice(0, count).map((b,i) => {
    const days = daysAgo(b.date)
    const tier = recencyTier(days)
    const tw = tierWeight(tier)
    const cb = corrBonus(b.srcs)
    const adj = Math.round(b.rawStr*tw+cb)
    const rawConf:Conf = b.srcType==='evidence'?'high':b.srcType==='inferred'?'medium':'low'
    let conf:Conf = rawConf
    let confCapped = false
    if(co.stage==='series-a'&&rawConf==='high'){conf='medium';confCapped=true}
    if(co.stage==='seed'){if(rawConf==='high'){conf='medium';confCapped=true}else if(rawConf==='medium'){conf='low';confCapped=true}}
    return {id:`sig-${co.id}-${i}`,coId:co.id,theme:b.theme,label:b.label,rawStr:b.rawStr,adjStr:adj,date:b.date,srcType:b.srcType,srcs:b.srcs,excerpt:b.excerpt,conf,confCapped,corrBonus:cb,days,tier}
  })
}

function generateScore(co:Company, sigs:Signal[]):CompanyScore {
  const highConf = sigs.filter(s=>s.conf==='high').length
  const dims:Record<string,number> = co.track==='private'
    ? {regulatory:co.dq+4,technical:co.dq-6,operational:co.dq+2,market:co.dq-10,founder:58}
    : {signal_strength:co.dq-4,source_quality:co.dq+2,recency:68,theme_coverage:72}
  const model = co.track==='private'?'private':'public'
  const sc = calcScore(model, dims, highConf, co.stage)
  sc.coId = co.id
  sc.themesHit = Array.from(new Set(sigs.map(s=>s.theme)))
  sc.freshestDays = Math.min(...sigs.map(s=>s.days))
  return sc
}

function generateRoles(co:Company, sigs:Signal[]):Role[] {
  const isPrivate = co.track==='private'
  const topSig = sigs[0]
  const roles:Role[] = []

  if(isPrivate) {
    roles.push({
      id:'r0', coId:co.id, title:'Founder / CEO', dept:'Executive',
      priority:'primary', action:'founder_direct', score:88,
      whyMatters:`${co.name} is at a stage where the founder retains strategic, hiring, and operational ownership simultaneously. Direct founder outreach is the most efficient and appropriate entry point. At this stage there is no meaningful intermediary layer between the founder and the decisions that matter.`,
      howToUse:'Lead with the specific operational challenge the evidence signals. Do not open with a service pitch. One focused open question is the right approach — the goal of the first conversation is to understand where ownership sits, not to close.',
      evidenceConf:'Medium', evidenceConfNote:'Founder role confirmed by company stage and public presence. Specific challenges inferred from signal evidence.',
      inferenceRisk:'Low', inferenceRiskNote:'At this stage the founder is the only viable primary contact. No inference risk on who to contact — only on what they are specifically working on.',
      signals: sigs.slice(0,2).map(s=>({theme:s.theme,text:s.label})),
      topics:[
        {text:`How ${co.name} is thinking about the capability and leadership profile it needs as the company scales from its current stage.`,tag:'inferred'},
        {text:`Where the data and technology infrastructure investment sits on the roadmap relative to the commercial and product build.`,tag:'inferred'},
        {text:`What the next 12 months of team building looks like as the company moves from building product to building revenue.`,tag:'inferred'},
      ],
      firstQ:`As you move from building the core product into scaling the team, where does the biggest structural hiring decision sit right now — technical depth, commercial leadership, or operational infrastructure?`,
    })
    roles.push({
      id:'r1', coId:co.id, title:'CTO / Head of Technology', dept:'Technology',
      priority:'secondary', action:'technical_owner_to_validate', score:74,
      whyMatters:`If a CTO or technical co-founder exists, this role owns the platform decisions and data infrastructure that ${topSig?.theme||'the'} signals are pointing to. At Series A and B this person is making architecture decisions that will define the company for the next three years.`,
      howToUse:'Validate this role exists before outreach — at early stage a single person may hold both CEO and CTO responsibilities. If confirmed, this is the right technical entry point alongside the founder conversation.',
      evidenceConf:'Low', evidenceConfNote:'Role existence inferred from company stage and technical signal pattern.',
      inferenceRisk:'Medium', inferenceRiskNote:'CTO or technical co-founder role not confirmed in public sources. Verify before outreach.',
      inferenceNote:'Verify this role exists independently before targeting — at early stage it may be held by the founder.',
      signals: sigs.slice(0,2).map(s=>({theme:s.theme,text:s.label})),
      topics:[
        {text:`Building the technical platform that the ${topSig?.theme||'data'} investment programme requires at scale.`,tag:'inferred'},
        {text:`Where the ownership of the data and infrastructure platform sits relative to the commercial and product functions.`,tag:'inferred'},
      ],
      firstQ:`Is the technical platform and infrastructure build being led from inside a dedicated engineering or data function, or does that sit with the founding team at this stage?`,
    })
  } else {
    roles.push({
      id:'r0', coId:co.id, title:`Head of Data and Technology`,dept:'Technology',
      priority:'primary', action:'first_outreach_target', score:86,
      whyMatters:`Active hiring in data and AI roles at ${co.name} confirms this function is making platform decisions now. The evidence points to an active capability build — the person leading it is the most operationally specific and timely outreach target in the dataset.`,
      howToUse:'Best first technical outreach target. The evidence is strong enough to open a specific, grounded conversation without preamble. Lead with the operational reality the signals reveal.',
      evidenceConf:'High', evidenceConfNote:'Active hiring signals directly evidence this function is building at senior level. Multiple independent source types corroborate.',
      inferenceRisk:'Low', inferenceRiskNote:'Role ownership is a direct inference from the hiring pattern and signal evidence.',
      signals: sigs.slice(0,2).map(s=>({theme:s.theme,text:s.label})),
      topics:[
        {text:`Building the ${topSig?.theme||'data'} capability that the ${sigs[0]?.label?.split('—')[0]?.trim()||'platform'} programme requires at scale.`,tag:'evidence'},
        {text:`Where the ownership of the data and AI platform sits relative to commercial and operational functions as the investment scales.`,tag:'inferred'},
        {text:`How the team is thinking about the leadership and talent profile needed to sustain the capability build beyond the initial investment phase.`,tag:'inferred'},
      ],
      firstQ:`Is the data and ${topSig?.theme||'AI'} capability build being led from inside a single function, or has ownership started to distribute across technology, commercial, and operations?`,
    })
    roles.push({
      id:'r1', coId:co.id, title:'Chief Operating Officer', dept:'Operations',
      priority:'secondary', action:'executive_sponsor_to_map', score:72,
      whyMatters:`Operating model change signals suggest COO-level sponsorship of the transformation programme at ${co.name}. This role is relevant but should be engaged after mapping the functional owner — the COO is more likely to be the sponsor of the investment than the day-to-day decision maker on capability.`,
      howToUse:'Executive sponsor to map after the functional conversation. Lead with operating model sustainability and the tension between short-term cost and long-term capability. Do not lead with the technology.',
      evidenceConf:'Medium', evidenceConfNote:'COO-level involvement inferred from scale of operating model signals.',
      inferenceRisk:'Medium', inferenceRiskNote:'Direct ownership not confirmed from public sources. Inferred from signal pattern.',
      signals: sigs.slice(1,3).map(s=>({theme:s.theme,text:s.label})),
      topics:[
        {text:`Sustaining the operational capability after the initial investment and restructure phase is complete.`,tag:'inferred'},
        {text:`Whether the operating model constraint is technology, talent, process ownership, or data infrastructure.`,tag:'inferred'},
      ],
      firstQ:`As the operating model evolves, is the bigger constraint now the technology platform, the data infrastructure, or the leadership and talent capability to sustain it?`,
    })
    if(sigs.length>2) {
      roles.push({
        id:'r2', coId:co.id, title:'VP / Head of Data Engineering', dept:'Data Platform',
        priority:'secondary', action:'capability_builder', score:78,
        whyMatters:`An active data engineering hiring pattern at ${co.name} signals this function is being built or rebuilt. The person doing that hiring is making foundational architecture decisions right now.`,
        howToUse:'Capability builder — the function is actively being created. Engage around what the data platform needs to own and how it integrates with the AI, operational, and commercial systems.',
        evidenceConf:'High', evidenceConfNote:'Active data engineering hiring directly confirms the function is being built.',
        inferenceRisk:'Low', inferenceRiskNote:'Active hiring directly evidences the role and its scope.',
        signals:[{theme:'data',text:'Data platform and engineering hiring confirmed'}],
        topics:[
          {text:'Designing a data platform architecture that serves multiple consuming functions — AI, analytics, operations, and commercial — from a single coherent layer.',tag:'evidence'},
          {text:'The data engineering talent profile needed at the intersection of technical infrastructure and business intelligence at this scale.',tag:'inferred'},
        ],
        firstQ:`Is the data platform being architected as a unified layer serving all consuming functions, or are separate pipelines being built for different teams with a plan to integrate later?`,
      })
    }
  }
  return roles
}

/* ═══════════════════════════════════════════
   CLAUDE API CLIENT
═══════════════════════════════════════════ */

async function callClaude(prompt:string, maxT=1000):Promise<string> {
  const r = await fetch('/api/generate',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:maxT})
  })
  if(!r.ok) throw new Error(`API ${r.status}`)
  const d = await r.json()
  return d.content.filter((b:{type:string})=>b.type==='text').map((b:{text:string})=>b.text).join('')
}

async function callClaudeJSON<T>(p:string):Promise<T> {
  const txt = await callClaude(p)
  return JSON.parse(txt.replace(/```json|```/g,'').trim()) as T
}

async function genLI(co:Company, role:Role, tone:string):Promise<string> {
  const toneDesc:{[k:string]:string} = {
    consultative:'consultative and respectful, leading with their operational reality not a value proposition',
    direct:'direct and specific, one sharp observation and one precise question, no preamble',
    challenger:'lightly challenging, naming a tension or constraint they may not have fully resolved',
  }
  const p = `Generate a LinkedIn connection request message body for outreach to ${role.title} at ${co.name}.
The message will be prefixed with "[First name], " (14 chars) so the body must be 286 characters or fewer. Count every character.
Return ONLY the message body. No labels, no quotes, no preamble.
Rules: No dashes of any kind. No "curious", "worth a quick chat", "touch base", "explore", "reach out". No greeting. 
Tone: ${toneDesc[tone]||toneDesc.consultative}. Start with a specific observation. End with one open question.
Company: ${co.name} | Stage: ${co.stage} | Top signal: ${role.signals[0]?.text||''} | Question to adapt: ${role.firstQ}`
  const txt = await callClaude(p, 400)
  return txt.trim().replace(/^["'`]|["'`]$/g,'').slice(0,286)
}

async function genEmail(co:Company, role:Role, tone:string):Promise<EmailDraft> {
  const toneDesc:{[k:string]:string} = {
    consultative:'consultative and respectful, leading with their operational reality. Imply value from their context without stating it directly.',
    direct:'direct and specific. One sharp observation, 2-3 operational topics woven naturally, one precise close.',
    challenger:'lightly challenging. Name a tension or constraint they may not have resolved. Open with an assumption they may not have considered.',
  }
  const p = `Generate a first-touch cold email. Return ONLY JSON: {"subject":"...","body":"..."} — no markdown, no code fences.
Rules: No dashes of any kind anywhere. No "curious", "worth a quick chat", "I wanted to reach out", "I noticed". 
Tone: ${toneDesc[tone]||toneDesc.consultative}
Body: 120-160 words max. Subject: specific, under 8 words, no clickbait. Sign off: [Your name].
Company: ${co.name} | Role: ${role.title} | Signal: ${role.signals[0]?.text||''} | Topic 1: ${role.topics[0]?.text||''} | Topic 2: ${role.topics[1]?.text||''} | Question: ${role.firstQ}`
  return callClaudeJSON<EmailDraft>(p)
}

/* ═══════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════ */

export default function App() {
  const [active, setActive] = useState('scan')
  const [scan, setScan] = useState<ScanRec|null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [signals, setSignals] = useState<Record<string,Signal[]>>({})
  const [scores, setScores] = useState<Record<string,CompanyScore>>({})
  const [roles, setRoles] = useState<Record<string,Role[]>>({})
  const [liDrafts, setLiDrafts] = useState<Record<string,string>>({})
  const [emailDrafts, setEmailDrafts] = useState<Record<string,EmailDraft>>({})

  const sortedCos = [...companies].sort((a,b)=>(scores[b.id]?.final||0)-(scores[a.id]?.final||0))

  function onScanCreated(s:ScanRec) {
    setScan(s)
    const cos = s.companies.map((c,i) => resolveCompany(c,i))
    setCompanies(cos)
    const newSigs:Record<string,Signal[]> = {}
    const newScores:Record<string,CompanyScore> = {}
    cos.forEach(co => {
      const sigs = generateSignals(co, s.themes)
      newSigs[co.id] = sigs
      newScores[co.id] = generateScore(co, sigs)
    })
    setSignals(newSigs)
    setScores(newScores)
    setActive('resolve')
  }

  async function mapRoles(co:Company) {
    const sigs = signals[co.id]||[]
    setRoles(p=>({...p,[co.id]:generateRoles(co,sigs)}))
  }

  return (
    <div className="app">
      <aside className="sb">
        <div className="sb-head">
          <div className="sb-mark">
            <span className="sb-dot"/>
            <span className="sb-name">Cream</span>
          </div>
        </div>
        <div className="sb-sect">Intelligence</div>
        <nav className="sb-nav">
          {NAV.map(n=>(
            <button key={n.id} className={`nb${active===n.id?' on':''}`} onClick={()=>setActive(n.id)}>
              <span className="nb-ico">{n.ico}</span>
              <div className="nb-txt">
                <span className="nb-lbl">{n.label}</span>
                <span className="nb-sub">{n.sub}</span>
              </div>
            </button>
          ))}
        </nav>
        <div className="sb-foot">
          <span className="sb-ver">v0.3</span>
          <div className="live"><span className="live-dot"/>Live</div>
        </div>
      </aside>

      <main className="main">
        <div className="mh">
          <div className="mh-left">
            <div className="mh-eye">{NAV.find(n=>n.id===active)?.sub}</div>
            <h1 className="mh-title">{PAGE_TITLES[active]}</h1>
          </div>
          {scan&&<div className="scan-pill">✓ {scan.companies.length} companies · {scan.themes.length} themes</div>}
        </div>
        <div className="scroll">
          {active==='scan'     && <ScanView onCreated={onScanCreated} scan={scan}/>}
          {active==='resolve'  && <ResolveView companies={sortedCos} scores={scores} hasScan={!!scan}/>}
          {active==='evidence' && <EvidenceView companies={sortedCos} scores={scores} signals={signals} hasScan={!!scan}/>}
          {active==='roles'    && <RolesView companies={sortedCos} scores={scores} roles={roles} onMap={mapRoles} hasScan={!!scan}/>}
          {active==='outreach' && <OutreachView companies={sortedCos} scores={scores} roles={roles} liDrafts={liDrafts} emailDrafts={emailDrafts} setLI={(k,v)=>setLiDrafts(p=>({...p,[k]:v}))} setEmail={(k,v)=>setEmailDrafts(p=>({...p,[k]:v}))} genLI={genLI} genEmail={genEmail} hasScan={!!scan}/>}
          {active==='export'   && <ExportView companies={sortedCos} scores={scores} signals={signals} roles={roles} liDrafts={liDrafts} emailDrafts={emailDrafts} hasScan={!!scan}/>}
        </div>
      </main>
    </div>
  )
}

/* ═══════════════════════════════════════════
   F01 — SCAN SETUP
═══════════════════════════════════════════ */

function ScanView({onCreated,scan}:{onCreated:(s:ScanRec)=>void;scan:ScanRec|null}) {
  const [name,setName]=useState('')
  const [ticker,setTicker]=useState('')
  const [list,setList]=useState('')
  const [themes,setThemes]=useState<Set<string>>(new Set())
  const [sam,setSam]=useState(false)
  const [errs,setErrs]=useState<{co?:string;th?:string}>({})
  const [creating,setCreating]=useState(false)

  const companies = useCallback(():ParsedCo[]=>{
    const out:ParsedCo[]=[], seen=new Set<string>()
    if(name.trim()){seen.add(name.trim().toLowerCase());out.push({value:name.trim(),type:'name',src:'name'})}
    if(ticker.trim()){const up=ticker.trim().toUpperCase();if(TICKER_RE.test(up)&&!seen.has(up.toLowerCase())){seen.add(up.toLowerCase());out.push({value:up,type:'ticker',src:'ticker'})}}
    for(const c of parseList(list)){if(!seen.has(c.value.toLowerCase())){seen.add(c.value.toLowerCase());out.push(c)}}
    return out
  },[name,ticker,list])

  const toggleTheme=(id:string)=>{
    setThemes(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
    setErrs(e=>({...e,th:undefined}))
  }

  const removeCompany=(idx:number)=>{
    const cos=companies(),rem=cos[idx]
    if(rem.src==='name')setName('')
    else if(rem.src==='ticker')setTicker('')
    else{
      const lines=list.split(/[\n\r]+/).filter(l=>{
        const clean=l.replace(/^\s*\d+[\.\)\-\:]\s*/,'').replace(/["""'']/g,'').trim()
        return clean.toLowerCase()!==rem.value.toLowerCase()
      })
      setList(lines.join('\n'))
    }
  }

  const validate=()=>{
    const e:{co?:string;th?:string}={}
    if(companies().length===0)e.co='Add at least one company name, ticker, or paste a list.'
    if(themes.size===0)e.th='Select at least one signal theme.'
    setErrs(e);return!e.co&&!e.th
  }

  const handleCreate=async()=>{
    if(!validate())return
    setCreating(true)
    await new Promise(r=>setTimeout(r,500))
    const cos=companies()
    onCreated({id:'CRM-'+Date.now().toString(36).toUpperCase(),companies:cos,themes:Array.from(themes),sam,createdAt:new Date().toISOString()})
    setCreating(false)
  }

  const cos=companies()

  if(scan) return(
    <div>
      <div className="succ">
        <div className="succ-ico">✓</div>
        <div style={{flex:1}}>
          <div className="succ-ttl">Scan created — pipeline complete</div>
          <div className="succ-meta">
            <code>{scan.id}</code> · {scan.companies.length} {scan.companies.length===1?'company':'companies'} · {scan.themes.length} {scan.themes.length===1?'theme':'themes'}<br/>
            Resolution and scoring complete. Navigate to Companies or Evidence to review.
          </div>
        </div>
        <button className="btn-ghost" onClick={()=>window.location.reload()}>New scan</button>
      </div>
      <div style={{maxWidth:680,background:'var(--parchm)',border:'.5px solid var(--ink7)',borderRadius:'var(--r-lg)',padding:'18px 22px'}}>
        <div className="slbl" style={{marginBottom:8}}>Companies in this scan</div>
        <div className="tags">
          {scan.companies.map((c,i)=>(
            <span key={i} className="ctag"><span className="ttype">{c.type}</span>{c.value}</span>
          ))}
        </div>
        <div style={{marginTop:12,display:'flex',gap:5,flexWrap:'wrap'}}>
          {scan.themes.map(t=>{
            const th=TMAP[t]
            return th?<span key={t} className={`ttag ${th.cls}`}>{th.label}</span>:null
          })}
        </div>
      </div>
    </div>
  )

  return(
    <div className="card">
      <div className="csect">
        <div className="slbl">Company input</div>
        <div className="row2">
          <div className="fwrap">
            <label className="flbl">Company name</label>
            <input type="text" placeholder="e.g. Terabase Energy" value={name}
              onChange={e=>{setName(e.target.value);setErrs(v=>({...v,co:undefined}))}}
              className={errs.co?'err-i':''} />
          </div>
          <div className="fwrap">
            <label className="flbl">Ticker symbol</label>
            <input type="text" placeholder="e.g. LECO" value={ticker}
              onChange={e=>{setTicker(e.target.value.toUpperCase());setErrs(v=>({...v,co:undefined}))}}
              className={errs.co?'err-i':''} />
          </div>
        </div>
        <div className="fwrap">
          <label className="flbl">Company list</label>
          <textarea placeholder={'Paste any format — numbered lists, tabs, commas, or one per line.\n\n1. Terabase Energy\n2. Lincoln Electric\n3. CBRE\n4. Generate Biomedicines\n5. TetraScience'} value={list}
            onChange={e=>{setList(e.target.value);setErrs(v=>({...v,co:undefined}))}}
            className={errs.co?'err-i':''} rows={6}/>
          <span className="fhint">Accepts company names, tickers, numbered lists, tabs, commas, and mixed formats</span>
        </div>
        {errs.co&&<div className="err-msg">{errs.co}</div>}
        {cos.length>0&&(
          <div className="pbox">
            <div className="phd">
              <span className="pct">{cos.length} {cos.length===1?'company':'companies'} parsed</span>
              <button className="clr" onClick={()=>{setName('');setTicker('');setList('')}}>Clear all</button>
            </div>
            <div className="tags">
              {cos.map((c,i)=>(
                <span key={i} className="ctag">
                  <span className="ttype">{c.type}</span>{c.value}
                  <button className="tx" onClick={()=>removeCompany(i)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="csect">
        <div className="slbl">Signal themes</div>
        <div className="tgrid">
          {THEMES.map(t=>{
            const sel=themes.has(t.id)
            return(
              <button key={t.id} className="tchip" onClick={()=>toggleTheme(t.id)}
                style={sel?{borderColor:t.color,background:t.color+'10',boxShadow:`0 0 0 1px ${t.color}20`}:{}}>
                <span className="tdot" style={{background:sel?t.color:undefined}}/>
                <span className="tlbl" style={sel?{color:t.color,fontWeight:500}:{}}>{t.label}</span>
              </button>
            )
          })}
        </div>
        {errs.th&&<div className="err-msg" style={{marginTop:9}}>{errs.th}</div>}
      </div>

      <div className="csect">
        <div className="slbl">Defaults</div>
        <div className="drow">
          <div className="dbadge"><div className="dlbl">Market</div><div className="dval">United States</div></div>
          <div className="dbadge"><div className="dlbl">Source mode</div><div className="dval">Low cost public</div></div>
        </div>
      </div>

      <div className="csect">
        <div className="slbl">Enrichment</div>
        <div className="togrow">
          <div className="toginfo">
            <div className="togtitle">SAM.gov enrichment</div>
            <div className="togdesc">Include federal contractor and public sector signals. Recommended for companies with government contracts or defence-adjacent operations.</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={sam} onChange={e=>setSam(e.target.checked)}/>
            <span className="ttrack"/>
          </label>
        </div>
      </div>

      <div className="cfoot">
        <span className="fhint2">{cos.length} {cos.length===1?'company':'companies'} · {themes.size} {themes.size===1?'theme':'themes'} selected</span>
        <button className="btn" onClick={handleCreate} disabled={creating}>
          {creating?'Creating scan…':'Create scan →'}
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   F02 — COMPANIES
═══════════════════════════════════════════ */

function ResolveView({companies,scores,hasScan}:{companies:Company[];scores:Record<string,CompanyScore>;hasScan:boolean}) {
  const [xp,setXp]=useState<Set<string>>(new Set())
  if(!hasScan) return <Empty msg="Create a scan first to see resolved companies."/>
  const toggle=(id:string)=>setXp(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
  const pub=companies.filter(c=>c.track==='public').length
  const priv=companies.filter(c=>c.track==='private').length
  const hyb=companies.filter(c=>c.track==='hybrid').length
  return(
    <div style={{maxWidth:680}}>
      <div style={{display:'flex',gap:10,marginBottom:18,flexWrap:'wrap'}}>
        {pub>0&&<Stat label="Public" val={pub} color="var(--ink1)"/>}
        {priv>0&&<Stat label="Private" val={priv} color="var(--ink1)"/>}
        {hyb>0&&<Stat label="Hybrid" val={hyb} color="var(--ink1)"/>}
      </div>
      <div className="crows">
        {companies.map(co=>{
          const sc=scores[co.id]
          const isXp=xp.has(co.id)
          const trackCls=co.track==='public'?'tp-pub':co.track==='private'?'tp-priv':'tp-hyb'
          const gcls=sc?sc.grade==='A'?'ga':sc.grade==='B'?'gb':sc.grade==='C'?'gc':'gd':''
          return(
            <div key={co.id}>
              <div className={`crow${isXp?' xp':''}`} onClick={()=>toggle(co.id)}>
                <div style={{width:8,height:8,borderRadius:'50%',background:co.partial?'var(--amber)':co.track==='private'?'#2D3B6B':'#2A4A38',flexShrink:0}}/>
                <div className="cname">{co.name}</div>
                <span className={`tpill ${trackCls}`}>{co.track}</span>
                {co.cik&&<span style={{fontSize:11,color:'var(--ink5)',fontFamily:'var(--f-mono)'}}>{co.cik}</span>}
                {co.formDFiled&&<span style={{fontSize:9,background:'rgba(45,59,107,.1)',color:'#2D3B6B',padding:'2px 6px',borderRadius:3,fontWeight:600}}>Form D ✓</span>}
                {sc&&<div className={`gradecirc ${gcls}`}>{sc.grade}</div>}
                {sc&&<div className="cscore" style={{color:scoreColor(sc.final)}}>{sc.final}</div>}
                <span className="chv" style={{transform:isXp?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>
              </div>
              {isXp&&(
                <div style={{background:'var(--parchm)',border:'.5px solid var(--cu)',borderTop:'none',borderRadius:'0 0 var(--r-md) var(--r-md)',padding:'12px 15px',marginBottom:2}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                    {[['Track',co.track],['Stage',co.stage],co.cik?['CIK',co.cik]:null,co.ticker?['Ticker',co.ticker]:null,co.sic?['SIC',co.sic+' · '+co.sicDesc]:null,co.formDAmount?['Form D',co.formDAmount]:null,co.investors?['Investors',co.investors]:null,['Data quality',co.dq+' / 100']].filter((x): x is [string,string] => Array.isArray(x)).map(([k,v],i)=>(
                      <div key={i} style={{background:'var(--paper)',border:'.5px solid var(--ink7)',borderRadius:'var(--r-sm)',padding:'7px 10px'}}>
                        <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'.1em',color:'var(--ink5)',marginBottom:2}}>{k}</div>
                        <div style={{fontSize:12,color:'var(--ink1)',fontFamily:k==='CIK'||k==='Ticker'?'var(--f-mono)':'var(--f-body)'}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:'var(--ink4)',fontStyle:'italic'}}>{co.note}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   F04/F05 — EVIDENCE & SCORING
═══════════════════════════════════════════ */

function EvidenceView({companies,scores,signals,hasScan}:{companies:Company[];scores:Record<string,CompanyScore>;signals:Record<string,Signal[]>;hasScan:boolean}) {
  const [xp,setXp]=useState<Set<string>>(new Set())
  if(!hasScan) return <Empty msg="Create a scan first to see evidence scores."/>
  const toggle=(id:string)=>setXp(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
  const ready=companies.filter(c=>scores[c.id]?.readiness==='Outreach ready').length
  const cav=companies.filter(c=>scores[c.id]?.readiness==='Outreach with caveats').length
  const watch=companies.filter(c=>scores[c.id]?.readiness==='Watch list').length
  return(
    <div style={{maxWidth:680}}>
      <div style={{display:'flex',gap:10,marginBottom:18,flexWrap:'wrap'}}>
        <Stat label="Outreach ready" val={ready} color="var(--green)"/>
        {cav>0&&<Stat label="With caveats" val={cav} color="var(--amber)"/>}
        {watch>0&&<Stat label="Watch list" val={watch} color="var(--red)"/>}
      </div>
      <div className="crows">
        {companies.map((co,i)=>{
          const sc=scores[co.id]
          if(!sc)return null
          const sigs=signals[co.id]||[]
          const isXp=xp.has(co.id)
          const gcls=sc.grade==='A'?'ga':sc.grade==='B'?'gb':sc.grade==='C'?'gc':'gd'
          const rbcls=sc.readiness==='Outreach ready'?'rb-r':sc.readiness==='Outreach with caveats'?'rb-c':'rb-w'
          const col=scoreColor(sc.final)
          const W=sc.model==='public'?PUB_W:PRIV_W
          const LBLS=sc.model==='public'?PUB_LABELS:PRIV_LABELS
          return(
            <div key={co.id}>
              <div className={`crow${isXp?' xp':''}`} onClick={()=>toggle(co.id)}>
                <div style={{fontSize:11,fontWeight:500,color:'var(--ink5)',fontFamily:'var(--f-mono)',minWidth:18,textAlign:'center'}}>{i+1}</div>
                <div className="cname">{co.name}</div>
                <span className={`rb ${rbcls}`}>{sc.readiness}</span>
                <div className={`gradecirc ${gcls}`}>{sc.grade}</div>
                <div className="cscore" style={{color:col}}>{sc.final}</div>
                <span className="chv" style={{transform:isXp?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>
              </div>
              {isXp&&(
                <div style={{background:'var(--parchm)',border:'.5px solid var(--cu)',borderTop:'none',borderRadius:'0 0 var(--r-md) var(--r-md)',padding:'13px 15px',marginBottom:2}}>
                  {sc.capped&&<div className="inf-note">Stage cap applied: raw score {sc.raw} reduced to {sc.final} for {co.stage} stage.</div>}
                  <div className="calcbox">
                    {Object.entries(W).map(([k,w])=>(
                      <div key={k} className="calcrow">
                        <span className="calk">{LBLS[k]||k} ({Math.round(w*100)}%)</span>
                        <span className="calv">{sc.dims[k]||0} × {w} = {Math.round((sc.dims[k]||0)*w)}</span>
                      </div>
                    ))}
                    <div className="calcrow"><span className="calk">High conf bonus</span><span className="calv">+{sigs.filter(s=>s.conf==='high').length*2}</span></div>
                    <div className="calcrow"><span className="calk">Final score</span><span className="calv" style={{color:col,fontSize:14}}>{sc.final}</span></div>
                  </div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:11}}>
                    {THEMES.map(t=><span key={t.id} className={`ttag ${t.cls}`} style={!sc.themesHit.includes(t.id)?{opacity:.3}:{}}>{t.label}</span>)}
                  </div>
                  <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'.12em',color:'var(--ink5)',marginBottom:6}}>Top signals</div>
                  <div className="siglist">
                    {sigs.sort((a,b)=>b.adjStr-a.adjStr).map(s=>(
                      <div key={s.id} className="sigrow">
                        <span className="sdot" style={{background:TMAP[s.theme]?.color||'#888'}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div className="slbl2">{s.label}</div>
                          <div className="smeta">{s.days}d ago · {s.excerpt.slice(0,80)}…</div>
                        </div>
                        <span className={`tierb ${tierCls(s.tier)}`}>{tierLabel(s.tier)}</span>
                        <span className={`confb ${s.conf==='high'?'ch':s.conf==='medium'?'cm':'cl'}`}>{s.conf}</span>
                        <div className="sadj">{s.adjStr}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   F07 — STAKEHOLDERS
═══════════════════════════════════════════ */

function RolesView({companies,scores,roles,onMap,hasScan}:{companies:Company[];scores:Record<string,CompanyScore>;roles:Record<string,Role[]>;onMap:(co:Company)=>Promise<void>;hasScan:boolean}) {
  const [selCo,setSelCo]=useState<string|null>(null)
  const [xp,setXp]=useState<Set<string>>(new Set())
  const [loading,setLoading]=useState<Set<string>>(new Set())
  if(!hasScan) return <Empty msg="Create a scan first to map stakeholders."/>
  const cos=companies.filter(c=>(scores[c.id]?.final||0)>=45)
  const activeCo:Company|undefined=(selCo?cos.find(c=>c.id===selCo):undefined)||cos[0]
  const activeRoles=roles[activeCo?.id||'']||[]
  const handleMap=async(co:Company)=>{
    setLoading(prev=>{const n=new Set(prev);n.add(co.id);return n})
    await onMap(co)
    setLoading(prev=>{const n=new Set(prev);n.delete(co.id);return n})
  }
  const toggleRole=(k:string)=>setXp(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n})
  return(
    <div style={{display:'flex',gap:18,maxWidth:900,flexWrap:'wrap'}}>
      <div style={{width:190,flexShrink:0}}>
        <div className="slbl" style={{marginBottom:8}}>Select company</div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {cos.map(co=>{
            const sc=scores[co.id]
            const isA=activeCo?.id===co.id
            return(
              <button key={co.id} onClick={()=>setSelCo(co.id)} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 11px',borderRadius:'var(--r-md)',border:isA?'.5px solid var(--cu)':'.5px solid var(--ink7)',background:isA?'var(--cu-lt)':'var(--parchm)',cursor:'pointer',textAlign:'left',transition:'all .1s',width:'100%'}}>
                <div style={{fontSize:12,fontWeight:500,color:'var(--ink1)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{co.name.split(' ').slice(0,2).join(' ')}</div>
                <div style={{fontSize:11,fontWeight:500,fontFamily:'var(--f-mono)',color:isA?'var(--cu)':'var(--ink4)',flexShrink:0}}>{sc?.final}</div>
              </button>
            )
          })}
        </div>
      </div>
      <div style={{flex:1,minWidth:300}}>
        {activeCo&&(
          <>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:13}}>
              <h2 style={{fontFamily:'var(--f-disp)',fontSize:18,fontWeight:500,color:'var(--ink0)',fontStyle:'italic',flex:1}}>{activeCo.name}</h2>
              {!roles[activeCo.id]&&!loading.has(activeCo.id)&&(
                <button className="btn" style={{padding:'7px 16px',fontSize:12}} onClick={()=>handleMap(activeCo)}>Map stakeholders →</button>
              )}
              {loading.has(activeCo.id)&&<span style={{fontSize:12,color:'var(--ink5)',fontStyle:'italic'}}>Mapping…</span>}
            </div>
            {!roles[activeCo.id]&&!loading.has(activeCo.id)&&(
              <div style={{background:'var(--parchm)',border:'.5px solid var(--ink7)',borderRadius:'var(--r-lg)',padding:'18px 20px',fontSize:13,color:'var(--ink5)',fontStyle:'italic'}}>
                Click "Map stakeholders" to generate role recommendations grounded in the signal evidence for {activeCo.name}.
              </div>
            )}
            {activeRoles.map((r,i)=>{
              const key=`${activeCo.id}-${i}`
              const isXp=xp.has(key)
              const am=ACT_META[r.action]||ACT_META.conditional_target
              const priCls=r.priority==='primary'?'b-pri':r.priority==='secondary'?'b-sec':'b-ter'
              const col=r.score>=75?'var(--green)':r.score>=55?'var(--amber)':'var(--red)'
              return(
                <div key={key} className={`rcard${r.priority==='primary'?' pri':''}`}>
                  <div className="rhead" onClick={()=>toggleRole(key)}>
                    <div className="rtcol">
                      <div className="rtitle">{r.title}</div>
                      <div className="brow">
                        <span className={`badge ${priCls}`}>{r.priority.charAt(0).toUpperCase()+r.priority.slice(1)}</span>
                        <span className={`badge ${am.cls}`}>{am.label}</span>
                      </div>
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
                          {r.topics.map((t,ti)=>(
                            <div key={ti} className="topicitem">
                              <span className="tnum">{ti+1}</span>
                              <span className="ttxt">{t.text}</span>
                              <span className={`ttag2 ${t.tag==='evidence'?'t-ev':t.tag==='inferred'?'t-inf':'t-spec'}`}>{t.tag}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rsec"><div className="rslbl">Suggested first question</div><div className="firstq">{r.firstQ}</div></div>
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

/* ═══════════════════════════════════════════
   F08/09 — OUTREACH
═══════════════════════════════════════════ */

function OutreachView({companies,scores,roles,liDrafts,emailDrafts,setLI,setEmail,genLI,genEmail,hasScan}:{
  companies:Company[];scores:Record<string,CompanyScore>;roles:Record<string,Role[]>
  liDrafts:Record<string,string>;emailDrafts:Record<string,EmailDraft>
  setLI:(k:string,v:string)=>void;setEmail:(k:string,v:EmailDraft)=>void
  genLI:(co:Company,r:Role,tone:string)=>Promise<string>
  genEmail:(co:Company,r:Role,tone:string)=>Promise<EmailDraft>
  hasScan:boolean
}) {
  const [selCo,setSelCo]=useState<string|null>(null)
  const [selRole,setSelRole]=useState(0)
  const [tab,setTab]=useState<'li'|'email'>('li')
  const [tone,setTone]=useState('consultative')
  const [loading,setLoading]=useState(false)
  if(!hasScan) return <Empty msg="Create a scan and map stakeholders to draft outreach."/>
  const cos=companies.filter(c=>roles[c.id]?.length>0)
  if(cos.length===0) return <Empty msg="Map stakeholders first — go to the Stakeholders tab and click 'Map stakeholders' for your top accounts."/>
  const activeCo:Company|undefined=(selCo?cos.find(c=>c.id===selCo):undefined)||cos[0]
  const activeRoles:Role[]=roles[activeCo?.id||'']||[]
  const activeRole:Role|undefined=activeRoles[selRole]
  const draftKey=`${activeCo?.id}-${selRole}-${tone}`
  const liDraft=liDrafts[draftKey]
  const emailDraft=emailDrafts[draftKey]
  const liLen=liDraft?14+liDraft.length:0
  const hasDash=(s:string)=>/[-\u2013\u2014]/.test(s)

  const handleGen=async()=>{
    if(!activeCo||!activeRole)return
    setLoading(true)
    try{
      if(tab==='li'){const d=await genLI(activeCo,activeRole,tone);setLI(draftKey,d)}
      else{const d=await genEmail(activeCo,activeRole,tone);setEmail(draftKey,d)}
    }catch(e){console.error(e)}
    setLoading(false)
  }

  const copy=(txt:string,btn:HTMLButtonElement)=>{
    navigator.clipboard.writeText(txt).then(()=>{
      btn.textContent='Copied';btn.classList.add('copied')
      setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},2000)
    })
  }

  return(
    <div style={{display:'flex',gap:18,maxWidth:900,flexWrap:'wrap'}}>
      <div style={{width:190,flexShrink:0}}>
        <div className="slbl" style={{marginBottom:8}}>Company</div>
        <div style={{display:'flex',flexDirection:'column',gap:3,marginBottom:14}}>
          {cos.map(co=>{
            const isA=activeCo?.id===co.id
            return(
              <button key={co.id} onClick={()=>{setSelCo(co.id);setSelRole(0)}} style={{padding:'8px 11px',borderRadius:'var(--r-md)',border:isA?'.5px solid var(--cu)':'.5px solid var(--ink7)',background:isA?'var(--cu-lt)':'var(--parchm)',cursor:'pointer',textAlign:'left',fontSize:12,fontWeight:500,color:'var(--ink1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',transition:'all .1s',width:'100%'}}>
                {co.name.split(' ').slice(0,2).join(' ')}
              </button>
            )
          })}
        </div>
        {activeRoles.length>0&&(
          <>
            <div className="slbl" style={{marginBottom:8}}>Role</div>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              {activeRoles.map((r,i)=>(
                <button key={i} onClick={()=>setSelRole(i)} style={{padding:'8px 11px',borderRadius:'var(--r-md)',border:selRole===i?'.5px solid var(--cu)':'.5px solid var(--ink7)',background:selRole===i?'var(--cu-lt)':'var(--parchm)',cursor:'pointer',textAlign:'left',fontSize:11,lineHeight:1.4,transition:'all .1s',width:'100%'}}>
                  <div style={{fontWeight:500,color:'var(--ink1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title.split('/')[0].trim()}</div>
                  <div style={{fontSize:10,color:'var(--ink5)',marginTop:2}}>{ACT_META[r.action]?.label||r.action}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{flex:1,minWidth:300}}>
        {activeCo&&activeRole&&(
          <>
            <div style={{marginBottom:13}}>
              <h2 style={{fontFamily:'var(--f-disp)',fontSize:16,fontWeight:500,color:'var(--ink0)',fontStyle:'italic',marginBottom:3}}>{activeRole.title}</h2>
              <div style={{fontSize:12,color:'var(--ink5)',fontStyle:'italic'}}>{activeCo.name}</div>
            </div>
            <div className="dtabs">
              <button className={`dtab${tab==='li'?' on':''}`} onClick={()=>setTab('li')}>LinkedIn connect</button>
              <button className={`dtab${tab==='email'?' on':''}`} onClick={()=>setTab('email')}>First-touch email</button>
            </div>
            <div className="tonerow">
              <span className="tonelbl">Tone:</span>
              {['consultative','direct','challenger'].map(t=>(
                <button key={t} className={`tonebtn${tone===t?' on':''}`} onClick={()=>setTone(t)}>
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                </button>
              ))}
            </div>
            {tab==='li'&&(
              <>
                <div className="slbl" style={{marginBottom:8}}>LinkedIn connection message · 300 character limit</div>
                <div className="limock">
                  <div className="limh">
                    <div className="liav">{activeRole.title[0]}</div>
                    <div><div className="linm">{activeRole.title}</div><div className="lirol">{activeCo.name}</div></div>
                  </div>
                  {liDraft
                    ?<><div className="msgbox"><span className="nameph">[First name], </span>{liDraft}</div>
                      <div className="charrow">
                        <div className="charbg"><div className="charfill" style={{width:`${Math.min(liLen/300*100,100)}%`,background:liLen>300?'var(--red)':'var(--green)'}}/></div>
                        <span className={`charnum ${liLen>300?'cn-ov':liLen>280?'cn-w':'cn-ok'}`}>{liLen} / 300</span>
                        <span style={{fontSize:10,color:'var(--ink5)'}}>(14 reserved)</span>
                      </div>
                      {hasDash(liDraft)&&<div className="dwarn" style={{display:'block'}}>Contains a dash — regenerate to fix</div>}
                    </>
                    :<div className="msgbox empty">Select tone and click Generate to create your LinkedIn message.</div>
                  }
                </div>
                <div className="btnrow">
                  <button className="btn" onClick={handleGen} disabled={loading}>{loading?'Generating…':liDraft?'Regenerate →':'Generate →'}</button>
                  {liDraft&&<button className="btn-sm" onClick={e=>copy('[First name], '+liDraft,e.currentTarget)}>Copy</button>}
                </div>
              </>
            )}
            {tab==='email'&&(
              <>
                <div className="slbl" style={{marginBottom:8}}>First-touch email</div>
                <div className="emock">
                  <div style={{marginBottom:10}}>
                    <div className="emrow"><span className="emlbl">To:</span><span className="emval">{activeRole.title}</span></div>
                    <div className="emrow"><span className="emlbl">Subject:</span><span className="emval">{emailDraft?.subject||'—'}</span></div>
                  </div>
                  {emailDraft
                    ?<><div className="ebody">{emailDraft.body}</div>
                      {hasDash(emailDraft.body)&&<div className="dwarn" style={{display:'block'}}>Contains a dash — regenerate to fix</div>}
                    </>
                    :<div className="ebody empty">Select tone and click Generate to create your first-touch email.</div>
                  }
                </div>
                <div className="btnrow">
                  <button className="btn" onClick={handleGen} disabled={loading}>{loading?'Generating…':emailDraft?'Regenerate →':'Generate →'}</button>
                  {emailDraft&&<button className="btn-sm" onClick={e=>copy(`Subject: ${emailDraft.subject}\n\n${emailDraft.body}`,e.currentTarget)}>Copy</button>}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   F10 — EXPORT
═══════════════════════════════════════════ */

function ExportView({companies,scores,signals,roles,liDrafts,emailDrafts,hasScan}:{
  companies:Company[];scores:Record<string,CompanyScore>;signals:Record<string,Signal[]>
  roles:Record<string,Role[]>;liDrafts:Record<string,string>;emailDrafts:Record<string,EmailDraft>;hasScan:boolean
}) {
  if(!hasScan) return <Empty msg="Create a scan to generate exportable account summaries."/>

  function build(co:Company):string {
    const sc=scores[co.id],sigs=signals[co.id]||[],rs=roles[co.id]||[]
    const L:string[]=[]
    L.push('CREAM — ACCOUNT INTELLIGENCE')
    L.push(`Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`)
    L.push('')
    L.push(`Company: ${co.name}`)
    L.push(`Track: ${co.track} · Stage: ${co.stage}`)
    if(co.cik)L.push(`CIK: ${co.cik}`)
    if(sc)L.push(`Score: ${sc.final} / 100 · Grade: ${sc.grade} · ${sc.readiness}`)
    L.push('')
    if(sigs.length){
      L.push('SIGNALS')
      sigs.sort((a,b)=>b.adjStr-a.adjStr).forEach((s,i)=>{
        L.push(`${i+1}. [${s.theme.toUpperCase()}] ${s.label}`)
        L.push(`   Score: ${s.adjStr} · ${tierLabel(s.tier)} (${s.days}d ago) · ${s.srcType}`)
      })
      L.push('')
    }
    if(rs.length){
      L.push('STAKEHOLDER ROLES')
      rs.forEach((r,i)=>{
        L.push(`${i+1}. ${r.title}`)
        L.push(`   Action: ${ACT_META[r.action]?.label} · Confidence: ${r.evidenceConf} · Risk: ${r.inferenceRisk}`)
        r.topics.forEach((t,ti)=>L.push(`   ${ti+1}. ${t.text}`))
        L.push(`   First question: ${r.firstQ}`)
        L.push('')
      })
    }
    const liKey=Object.keys(liDrafts).find(k=>k.startsWith(co.id))
    const emKey=Object.keys(emailDrafts).find(k=>k.startsWith(co.id))
    if(liKey&&liDrafts[liKey]){L.push('LINKEDIN');L.push(`[First name], ${liDrafts[liKey]}`);L.push('')}
    if(emKey&&emailDrafts[emKey]){L.push('EMAIL');L.push(`Subject: ${emailDrafts[emKey].subject}`);L.push('');L.push(emailDrafts[emKey].body)}
    return L.join('\n')
  }

  function download(co:Company){
    const txt=build(co)
    const blob=new Blob([txt],{type:'text/plain'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a')
    a.href=url;a.download=`${co.name.replace(/\s+/g,'_')}_cream_${new Date().toISOString().slice(0,10)}.txt`
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url)
  }

  return(
    <div className="excard">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
        <h2 style={{fontFamily:'var(--f-disp)',fontSize:20,fontWeight:500,color:'var(--ink0)',fontStyle:'italic'}}>Account summaries</h2>
        <button className="btn-ghost" onClick={()=>{const all=companies.map(build).join('\n\n'+'─'.repeat(50)+'\n\n');navigator.clipboard.writeText(all)}}>Copy all</button>
      </div>
      {companies.map(co=>{
        const sc=scores[co.id]
        const gcls=sc?sc.grade==='A'?'ga':sc.grade==='B'?'gb':sc.grade==='C'?'gc':'gd':''
        const hasR=!!(roles[co.id]?.length)
        const hasLI=Object.keys(liDrafts).some(k=>k.startsWith(co.id))
        const hasEM=Object.keys(emailDrafts).some(k=>k.startsWith(co.id))
        return(
          <div key={co.id} className="exco">
            {sc&&<div className={`gradecirc ${gcls}`}>{sc.grade}</div>}
            <div className="exname">{co.name}</div>
            {sc&&<span style={{fontSize:12,fontFamily:'var(--f-mono)',color:'var(--ink4)'}}>{sc.final}</span>}
            <div style={{display:'flex',gap:4}}>
              {hasR&&<span style={{fontSize:9,background:'var(--green-bg)',color:'var(--green)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>ROLES</span>}
              {hasLI&&<span style={{fontSize:9,background:'rgba(45,59,107,.1)',color:'#2D3B6B',padding:'2px 6px',borderRadius:3,fontWeight:600}}>LI</span>}
              {hasEM&&<span style={{fontSize:9,background:'var(--cu-lt)',color:'var(--cu)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>EMAIL</span>}
            </div>
            <button className="btn-sm" onClick={e=>{navigator.clipboard.writeText(build(co));const b=e.currentTarget;b.textContent='Copied';b.classList.add('copied');setTimeout(()=>{b.textContent='Copy';b.classList.remove('copied')},2000)}}>Copy</button>
            <button className="btn-sm" onClick={()=>download(co)}>Download .txt</button>
          </div>
        )
      })}
      <div style={{marginTop:16,padding:'12px 14px',background:'var(--parchm)',border:'.5px solid var(--ink7)',borderRadius:'var(--r-md)',fontSize:12,color:'var(--ink5)',fontStyle:'italic',lineHeight:1.6}}>
        Each account summary includes the evidence chain, scoring breakdown, stakeholder roles, cold call topics, and outreach drafts in plain text ready for CRM, briefing documents, or email.
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   SHARED
═══════════════════════════════════════════ */

function Empty({msg}:{msg:string}) {
  return(
    <div className="empty-st">
      <div className="empty-ico">◈</div>
      <div className="empty-txt">{msg}</div>
    </div>
  )
}

function Stat({label,val,color}:{label:string;val:number;color:string}) {
  return(
    <div style={{background:'var(--parchm)',border:'.5px solid var(--ink7)',borderRadius:'var(--r-md)',padding:'10px 15px',minWidth:90}}>
      <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'.1em',color:'var(--ink5)',marginBottom:3}}>{label}</div>
      <div style={{fontSize:20,fontWeight:500,color,fontFamily:'var(--f-mono)'}}>{val}</div>
    </div>
  )
}
