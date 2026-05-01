'use client'
import { useState, useCallback, useRef } from 'react'

/* ══════════════════════════════════════════════
   CONSTANTS & TYPES
══════════════════════════════════════════════ */

const THEMES = [
  { id:'data',       label:'Data capability',         color:'#1A3D5C', cls:'tt-data' },
  { id:'ai',         label:'AI readiness',            color:'#2D3B6B', cls:'tt-ai' },
  { id:'automation', label:'Automation',              color:'#2A4A38', cls:'tt-automation' },
  { id:'tom',        label:'Operating model change',  color:'#5C3D1A', cls:'tt-tom' },
  { id:'cost',       label:'Cost transformation',     color:'#6B2020', cls:'tt-cost' },
  { id:'ops',        label:'Operational improvement', color:'#2E5C18', cls:'tt-ops' },
]

const THEME_MAP = Object.fromEntries(THEMES.map(t => [t.id, t]))

const TICKER_RE = /^[A-Z]{1,5}$/

type Track = 'public'|'private'|'hybrid'
type Stage = 'public'|'series-b'|'series-a'|'seed'|'private'|'pe'
type Tier  = 'live'|'recent'|'current'|'active'|'excluded'
type Conf  = 'high'|'medium'|'low'
type SrcType = 'evidence'|'inferred'|'speculative'
type ActionType = 'founder_direct'|'first_outreach_target'|'technical_owner_to_validate'|'executive_sponsor_to_map'|'operational_owner'|'capability_builder'|'conditional_target'

interface ParsedCo { value:string; type:'name'|'ticker'; src:string }

interface Company {
  id:string; name:string; track:Track; stage:Stage;
  cik?:string; ticker?:string; sic?:string; sicDesc?:string;
  formDFiled?:boolean; formDAmount?:string; investors?:string;
  dq:number; partial:boolean; note:string;
}

interface Signal {
  id:string; coId:string; theme:string; label:string;
  rawStr:number; adjStr:number; date:string;
  srcType:SrcType; srcs:number; excerpt:string;
  conf:Conf; confCapped:boolean; corrBonus:number;
  days:number; tier:Tier;
}

interface CompanyScore {
  coId:string; model:'public'|'private'; raw:number; final:number;
  capped:boolean; cap:number; grade:'A'|'B'|'C'|'D';
  readiness:'Outreach ready'|'Outreach with caveats'|'Watch list';
  dims:Record<string,number>; themesHit:string[]; freshestDays:number;
}

interface StakeholderRole {
  id:string; coId:string; title:string; dept:string;
  priority:'primary'|'secondary'|'tertiary'; action:ActionType; score:number;
  whyMatters:string; howToUse:string;
  evidenceConf:'High'|'Medium'|'Low'; evidenceConfNote:string;
  inferenceRisk:'Low'|'Medium'|'High'; inferenceRiskNote:string;
  inferenceNote?:string;
  signals:{theme:string;text:string}[];
  topics:{text:string;tag:SrcType}[];
  firstQ:string;
}

interface OutreachDraft { subject?:string; body:string }

interface ScanRecord {
  id:string; companies:ParsedCo[]; themes:string[]; sam:boolean; createdAt:string;
}

/* ══════════════════════════════════════════════
   SCORING HELPERS
══════════════════════════════════════════════ */

const TODAY = new Date('2026-04-27')
function daysAgo(d:string){ return Math.round((TODAY.getTime()-new Date(d).getTime())/86400000) }
function recencyTier(days:number):Tier{ if(days<=14)return'live';if(days<=60)return'recent';if(days<=180)return'current';if(days<=365)return'active';return'excluded' }
function tierWeight(t:Tier){ return({live:1,recent:.9,current:.7,active:.45,excluded:0} as Record<string,number>)[t] }
function tierLabel(t:Tier){ return{live:'Live',recent:'Recent',current:'Current',active:'Active',excluded:'Excl.'}[t]||t }
function tierCls(t:Tier){ return({live:'tb-live',recent:'tb-recent',current:'tb-current',active:'tb-active'} as Record<string,string>)[t]||'tb-active' }
function corrBonus(srcs:number){ return srcs>=3?8:srcs===2?4:0 }
function stageCap(s:Stage){ return{public:100,'series-b':100,'series-a':78,seed:65,private:100,pe:55}[s] }
function gradeOf(n:number):'A'|'B'|'C'|'D'{ return n>=80?'A':n>=65?'B':n>=50?'C':'D' }
function readinessOf(n:number){ return n>=65?'Outreach ready':n>=45?'Outreach with caveats':'Watch list' }

const PUBLIC_WEIGHTS  = {signal_strength:.40,source_quality:.30,recency:.20,theme_coverage:.10}
const PRIVATE_WEIGHTS = {regulatory:.35,technical:.25,operational:.20,market:.15,founder:.05}

function calcScore(model:'public'|'private', dims:Record<string,number>, highConf:number, stage:Stage):CompanyScore {
  const weights = model==='public' ? PUBLIC_WEIGHTS : PRIVATE_WEIGHTS
  let raw = Object.entries(weights).reduce((a,[k,w])=>a+(dims[k]||0)*w,0) + highConf*2
  raw = Math.round(raw)
  const cap = stageCap(stage)
  const final = Math.min(raw,cap)
  return { coId:'', model, raw, final, capped:raw>cap, cap, grade:gradeOf(final), readiness:readinessOf(final) as CompanyScore['readiness'], dims, themesHit:[], freshestDays:999 }
}

/* ══════════════════════════════════════════════
   CLAUDE API CLIENT
══════════════════════════════════════════════ */

async function callClaude(prompt:string, maxTokens=1000):Promise<string> {
  const res = await fetch('/api/generate',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:maxTokens})
  })
  if(!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json()
  return data.content.filter((b:{type:string})=>b.type==='text').map((b:{text:string})=>b.text).join('')
}

async function callClaudeJSON<T>(prompt:string):Promise<T> {
  const txt = await callClaude(prompt)
  return JSON.parse(txt.replace(/```json|```/g,'').trim()) as T
}

/* ══════════════════════════════════════════════
   LIST PARSER
══════════════════════════════════════════════ */

function parseList(raw:string):ParsedCo[] {
  const out:ParsedCo[]=[], seen=new Set<string>()
  for(const line of raw.split(/[\n\r]+/)){
    for(let part of line.split(/[\t,]+/)){
      part=part.replace(/^\s*\d+[\.\)\-\:]\s*/,'').replace(/["""'']/g,'').trim()
      if(!part||part.length<2)continue
      const key=part.toLowerCase()
      if(seen.has(key))continue
      seen.add(key)
      const up=part.toUpperCase()
      out.push({value:TICKER_RE.test(up)?up:part,type:TICKER_RE.test(up)?'ticker':'name',src:'list'})
    }
  }
  return out
}

/* ══════════════════════════════════════════════
   MOCK DATA GENERATOR
   Produces realistic data so the full pipeline
   works without real API calls for resolution/scoring
══════════════════════════════════════════════ */

function mockResolve(cos:ParsedCo[]):Company[] {
  const knownPublic:{[k:string]:{cik:string;ticker:string;sic:string;sicDesc:string}} = {
    'cbre':       {cik:'0001138118',ticker:'CBRE',sic:'6552',sicDesc:'Real estate services'},
    'lincoln electric':{cik:'0000059527',ticker:'LECO',sic:'3460',sicDesc:'Metal forgings'},
    'boehringer ingelheim':{cik:'0000014930',ticker:'',sic:'2836',sicDesc:'Pharmaceutical preparations'},
    'pattern energy':{cik:'0001561921',ticker:'',sic:'4911',sicDesc:'Electric services'},
    'hanwha':     {cik:'0001826397',ticker:'',sic:'3674',sicDesc:'Semiconductors'},
    'ionis':      {cik:'0000765258',ticker:'IONS',sic:'2836',sicDesc:'Pharmaceutical preparations'},
    'regenxbio':  {cik:'0001580063',ticker:'RGNX',sic:'2836',sicDesc:'Pharmaceutical preparations'},
    'corcept':    {cik:'0001088822',ticker:'CORT',sic:'2836',sicDesc:'Pharmaceutical preparations'},
    'si-bone':    {cik:'0001555280',ticker:'SIBN',sic:'3841',sicDesc:'Surgical instruments'},
    'uranium energy':{cik:'0001334978',ticker:'UEC',sic:'1094',sicDesc:'Uranium ores'},
  }
  const privateStages:{[k:string]:Stage} = {
    'terabase':'series-b','generate biomedicines':'series-b','priovant':'series-b',
    'tetrascience':'series-b','paragon':'series-b','eikon':'series-b',
    'crux climate':'series-a','navigator':'series-a','crux':'series-a',
    'arclight':'pe','depcom':'private','middle river':'private',
    'sunstrong':'private','twain':'private','orenda':'seed',
  }
  return cos.map((c,i)=>{
    const key = c.value.toLowerCase()
    const pubMatch = Object.keys(knownPublic).find(k=>key.includes(k))
    const privStage = Object.keys(privateStages).find(k=>key.includes(k))

    if(pubMatch){
      const p = knownPublic[pubMatch]
      const isHybrid = !p.ticker
      return{
        id:`co-${i}`,name:c.value,track:isHybrid?'hybrid':'public' as Track,stage:'public' as Stage,
        cik:p.cik,ticker:p.ticker||undefined,sic:p.sic,sicDesc:p.sicDesc,
        dq:isHybrid?58:90,partial:isHybrid,
        note:isHybrid?'Hybrid entity — supplementing EDGAR with private source set.':'SEC EDGAR resolved.',
      }
    }
    if(privStage){
      const stage = privateStages[privStage] as Stage
      return{
        id:`co-${i}`,name:c.value,track:'private' as Track,stage,
        formDFiled:stage!=='seed'&&stage!=='pe',
        formDAmount:stage==='series-b'?'$50–150m':stage==='series-a'?'$15–60m':undefined,
        investors:'Institutional VC',
        dq:stage==='series-b'?72:stage==='series-a'?55:stage==='seed'?30:38,partial:false,
        note:`Private ${stage} company. Form D ${stage!=='seed'&&stage!=='pe'?'confirmed':'not filed'}.`,
      }
    }
    // Unknown — try to classify
    const isLikelyPublic = /\b(inc|corp|plc|ltd|llc)\b/.test(key)&&(key.includes('usa')||key.includes('america'))
    return{
      id:`co-${i}`,name:c.value,track:'private' as Track,stage:'private' as Stage,
      formDFiled:true,dq:45,partial:false,
      note:'Resolved via public web sources. Data quality moderate.',
    }
  })
}

function mockSignals(co:Company, themes:string[]):Signal[] {
  const base:Partial<Signal>[] = [
    {theme:themes[0]||'data',label:`${co.name} — data and AI capability hiring surge`,rawStr:82,date:'2026-04-10',srcType:'evidence',srcs:3,excerpt:`Active hiring in data engineering and AI at ${co.name} signals active platform investment.`},
    {theme:themes[1]||'ai',label:`AI platform investment — public disclosure confirmed`,rawStr:76,date:'2026-02-15',srcType:'evidence',srcs:2,excerpt:`${co.name} has publicly confirmed AI investment as a strategic priority.`},
    {theme:themes[2]||'ops',label:`Operating model transformation underway`,rawStr:68,date:'2025-11-20',srcType:'inferred',srcs:2,excerpt:`Hiring and press signals indicate operating model change at ${co.name}.`},
  ]
  if(themes.length>3) base.push({theme:themes[3],label:`${themes[3]} investment programme`,rawStr:62,date:'2025-09-10',srcType:'inferred',srcs:1,excerpt:`Signal detected in public sources.`})

  return base.map((b,i)=>{
    const days=daysAgo(b.date as string)
    const tier=recencyTier(days)
    const tw=tierWeight(tier)
    const cb=corrBonus(b.srcs||1)
    const raw=b.rawStr||60
    const adj=Math.round(raw*tw+cb)
    const rawConf:Conf=b.srcType==='evidence'?'high':b.srcType==='inferred'?'medium':'low'
    let conf:Conf=rawConf
    let confCapped=false
    if(co.stage==='series-a'&&rawConf==='high'){conf='medium';confCapped=true}
    if(co.stage==='seed'){if(rawConf==='high'){conf='medium';confCapped=true}else if(rawConf==='medium'){conf='low';confCapped=true}}
    return{id:`sig-${i}`,coId:co.id,theme:b.theme||'data',label:b.label||'Signal',rawStr:raw,adjStr:adj,date:b.date as string,srcType:b.srcType||'inferred',srcs:b.srcs||1,excerpt:b.excerpt||'',conf,confCapped,corrBonus:cb,days,tier}
  })
}

function mockScore(co:Company, sigs:Signal[]):CompanyScore {
  const highConf = sigs.filter(s=>s.conf==='high').length
  const dims: Record<string,number> = co.track==='public'||co.track==='hybrid'
    ? {signal_strength:co.dq-5, source_quality:co.dq, recency:70, theme_coverage:75}
    : {regulatory:co.dq+5, technical:co.dq-8, operational:co.dq, market:co.dq-12, founder:55}
  const sc = calcScore(co.track==='private'?'private':'public', dims, highConf, co.stage)
  sc.coId = co.id
  sc.themesHit = Array.from(new Set(sigs.map(s=>s.theme)))
  sc.freshestDays = Math.min(...sigs.map(s=>s.days))
  return sc
}

function mockRoles(co:Company, sigs:Signal[]):StakeholderRole[] {
  const isPrivate = co.track==='private'
  const roles:StakeholderRole[] = []

  if(isPrivate){
    roles.push({
      id:'r0',coId:co.id,title:'Founder / CEO',dept:'Executive',
      priority:'primary',action:'founder_direct',score:88,
      whyMatters:`${co.name} is at a stage where the founder owns the strategic, hiring, and operational agenda simultaneously. Direct founder outreach is the appropriate and most efficient entry point.`,
      howToUse:'Lead with the specific operational challenge the evidence signals. Do not route through an intermediary. One focused open question is the right approach.',
      evidenceConf:'Medium',evidenceConfNote:'Founder role inferred from company stage and public presence.',
      inferenceRisk:'Low',inferenceRiskNote:'At this stage the founder is the only viable primary contact.',
      signals:sigs.slice(0,2).map(s=>({theme:s.theme,text:s.label})),
      topics:[
        {text:`How ${co.name} is thinking about the capability and leadership profile needed as the company scales from its current stage.`,tag:'inferred'},
        {text:`Where the data and technology infrastructure investment sits on the roadmap relative to the product and commercial build.`,tag:'inferred'},
        {text:`What the next 12 months of team building looks like as the company moves from building product to building revenue.`,tag:'inferred'},
      ],
      firstQ:`As you move from building the core product into scaling the team, where does the biggest structural hiring decision sit right now — technical depth, commercial leadership, or operational infrastructure?`
    })
  } else {
    roles.push({
      id:'r0',coId:co.id,title:`Head of Data and Technology`,dept:'Technology',
      priority:'primary',action:'first_outreach_target',score:85,
      whyMatters:`Active hiring in data and AI roles confirms this function is making platform decisions now. This is the most operationally specific outreach target for the signals detected.`,
      howToUse:'Best first technical outreach target. The evidence is strong enough to open a specific conversation without preamble.',
      evidenceConf:'High',evidenceConfNote:'Active hiring signals directly evidence this function is building.',
      inferenceRisk:'Low',inferenceRiskNote:'Role ownership is a direct inference from the hiring pattern.',
      signals:sigs.slice(0,2).map(s=>({theme:s.theme,text:s.label})),
      topics:[
        {text:`Building the data and AI capability that the ${sigs[0]?.theme||'platform'} programme requires at scale.`,tag:'evidence'},
        {text:`Where the ownership of the data platform sits relative to the technical and commercial functions.`,tag:'inferred'},
        {text:`How the team is thinking about the talent profile needed to sustain the investment beyond the initial build phase.`,tag:'inferred'},
      ],
      firstQ:`Is the data and AI capability build being led from inside the technology function, or does ownership sit across technology, commercial, and operations?`
    })
    roles.push({
      id:'r1',coId:co.id,title:'Chief Operating Officer',dept:'Operations',
      priority:'secondary',action:'executive_sponsor_to_map',score:72,
      whyMatters:`Operating model change signals suggest COO-level sponsorship. This role is relevant but should be engaged after mapping the functional owner.`,
      howToUse:'Executive sponsor to map after the technical conversation. Lead with operating model sustainability rather than specific technology.',
      evidenceConf:'Medium',evidenceConfNote:'COO involvement inferred from scale of operating model signals.',
      inferenceRisk:'Medium',inferenceRiskNote:'Direct ownership not confirmed from public sources.',
      signals:sigs.slice(1,3).map(s=>({theme:s.theme,text:s.label})),
      topics:[
        {text:`Sustaining the operational capability after the initial investment phase is complete.`,tag:'inferred'},
        {text:`Whether the operating model constraint is technology, talent, process ownership, or data infrastructure.`,tag:'inferred'},
      ],
      firstQ:`As the operating model evolves, is the bigger constraint now the technology platform, the data infrastructure, or the leadership capability needed to sustain it?`
    })
  }
  return roles
}

/* ══════════════════════════════════════════════
   NAV CONFIG
══════════════════════════════════════════════ */

const NAV = [
  {id:'scan',   label:'New scan',     feat:'F01', ico:'✦', sub:'Define an intelligence scan.'},
  {id:'resolve',label:'Resolution',   feat:'F02', ico:'◈', sub:'SEC EDGAR and Form D lookup.'},
  {id:'score',  label:'Scoring',      feat:'F05', ico:'◎', sub:'Evidence scoring and ranking.'},
  {id:'roles',  label:'Stakeholders', feat:'F07', ico:'◉', sub:'Role mapping and sales action layer.'},
  {id:'outreach',label:'Outreach',    feat:'F08–09',ico:'◆',sub:'LinkedIn and email message drafting.'},
  {id:'export', label:'Export',       feat:'F10', ico:'⬡', sub:'Account summary export.'},
]

const PAGE_SUBTITLES:{[k:string]:string} = {
  scan:    'From early technical teams to the first commercial hires, we help founders build the structure that allows a company to take shape and scale with intent.',
  resolve: 'Resolving companies against SEC EDGAR, Form D records, and public source sets.',
  score:   'Ranking companies by evidence quality, recency, and signal confidence.',
  roles:   'Mapping signals to the people who own the problem — and how to reach them.',
  outreach:'Evidence-grounded messages that open conversations, not inboxes.',
  export:  'Account intelligence packaged for review, sharing, and action.',
}

/* ══════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════ */

export default function App() {
  const [active, setActive] = useState('scan')

  // Pipeline state
  const [scan, setScan]         = useState<ScanRecord|null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [signals, setSignals]   = useState<Record<string,Signal[]>>({})
  const [scores, setScores]     = useState<Record<string,CompanyScore>>({})
  const [roles, setRoles]       = useState<Record<string,StakeholderRole[]>>({})
  const [liDrafts, setLiDrafts] = useState<Record<string,string>>({})
  const [emailDrafts, setEmailDrafts] = useState<Record<string,OutreachDraft>>({})

  const hasScan = !!scan
  const hasScores = Object.keys(scores).length > 0

  // Sorted companies by score
  const sortedCos = [...companies].sort((a,b)=>(scores[b.id]?.final||0)-(scores[a.id]?.final||0))

  /* ── Scan created ── */
  function onScanCreated(s:ScanRecord) {
    setScan(s)
    // Immediately resolve
    const cos = mockResolve(s.companies)
    setCompanies(cos)
    // Score all
    const newSigs:Record<string,Signal[]> = {}
    const newScores:Record<string,CompanyScore> = {}
    cos.forEach(co=>{
      const sigs = mockSignals(co, s.themes)
      newSigs[co.id] = sigs
      newScores[co.id] = mockScore(co, sigs)
    })
    setSignals(newSigs)
    setScores(newScores)
    setActive('resolve')
  }

  /* ── Generate roles for a company ── */
  async function generateRoles(co:Company) {
    const sigs = signals[co.id]||[]
    const generated = mockRoles(co, sigs)
    setRoles(prev=>({...prev,[co.id]:generated}))
  }

  /* ── Generate LI draft ── */
  async function generateLI(coId:string, roleIdx:number, tone:string):Promise<string> {
    const co = companies.find(c=>c.id===coId)
    if(!co) return ''
    const role = roles[coId]?.[roleIdx]
    if(!role) return ''
    const prompt=`Generate a LinkedIn connection request message body. The message will be prefixed with "[First name], " (14 chars) so the body must be 286 chars or fewer.
Return ONLY the message body. No labels, no quotes.
Rules: No dashes. No "curious","worth a quick chat","touch base","explore","reach out". No greeting. Tone: ${tone}. Start with observation. End with one open question.
Company: ${co.name} | Role: ${role.title} | Topic: ${role.topics[0]?.text||''} | Question: ${role.firstQ}`
    const txt = await callClaude(prompt, 400)
    return txt.trim().replace(/^["'`]|["'`]$/g,'').slice(0,286)
  }

  /* ── Generate email draft ── */
  async function generateEmail(coId:string, roleIdx:number, tone:string):Promise<OutreachDraft> {
    const co = companies.find(c=>c.id===coId)
    if(!co) return {body:''}
    const role = roles[coId]?.[roleIdx]
    if(!role) return {body:''}
    const prompt=`Generate a first-touch cold email. Return ONLY JSON: {"subject":"...","body":"..."} — no markdown.
Rules: No dashes. No "curious","worth a quick chat","I wanted to reach out". Tone: ${tone}. Imply value from their internal focus. Weave 2-3 topics naturally. Close with one open question. Body 120-160 words. Subject under 8 words. Sign off: [Your name].
Company: ${co.name} | Role: ${role.title} | Topic1: ${role.topics[0]?.text||''} | Topic2: ${role.topics[1]?.text||''} | Q: ${role.firstQ}`
    return callClaudeJSON<OutreachDraft>(prompt)
  }

  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sb">
        <div className="sb-head">
          <div className="sb-logo">
            <span className="sb-logo-mark" />
            Cream
          </div>
          <div className="sb-tagline">The partner founders rely on when each hire changes the trajectory of the business.</div>
        </div>

        <div className="sb-section-head">Intelligence</div>
        <nav className="sb-nav">
          {NAV.map(n=>(
            <button key={n.id} className={`nav-btn${active===n.id?' active':''}`} onClick={()=>setActive(n.id)}>
              <span className="nav-ico">{n.ico}</span>
              <div className="nav-txt">
                <span className="nav-lbl">{n.label}</span>
                <span className="nav-feat">{n.feat}</span>
              </div>
            </button>
          ))}
        </nav>

        <div className="sb-foot">
          <span className="sb-version">v0.2.0</span>
          <div className="live-pill"><span className="live-dot"/>Live</div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        <div className="main-head">
          <div className="head-left">
            <div className="page-eyebrow">{NAV.find(n=>n.id===active)?.feat}</div>
            <h1 className="page-title">{NAV.find(n=>n.id===active)?.label}</h1>
            <p className="page-sub">{PAGE_SUBTITLES[active]}</p>
          </div>
          {hasScan&&(
            <div className="head-right">
              <div className="scan-badge">✓ {scan!.companies.length} companies · {scan!.themes.length} themes</div>
            </div>
          )}
        </div>

        <div className="content">
          {active==='scan'    && <ScanView onCreated={onScanCreated} hasScan={hasScan} scan={scan} />}
          {active==='resolve' && <ResolveView companies={companies} hasScan={hasScan} />}
          {active==='score'   && <ScoreView companies={sortedCos} scores={scores} signals={signals} hasScan={hasScan} />}
          {active==='roles'   && <RolesView companies={sortedCos} scores={scores} roles={roles} onGenerate={generateRoles} hasScan={hasScan} />}
          {active==='outreach'&& <OutreachView companies={sortedCos} scores={scores} roles={roles} liDrafts={liDrafts} emailDrafts={emailDrafts} onSetLI={(k,v)=>setLiDrafts(p=>({...p,[k]:v}))} onSetEmail={(k,v)=>setEmailDrafts(p=>({...p,[k]:v}))} generateLI={generateLI} generateEmail={generateEmail} hasScan={hasScan} />}
          {active==='export'  && <ExportView companies={sortedCos} scores={scores} signals={signals} roles={roles} liDrafts={liDrafts} emailDrafts={emailDrafts} hasScan={hasScan} />}
        </div>
      </main>
    </div>
  )
}

/* ══════════════════════════════════════════════
   F01 — SCAN SETUP
══════════════════════════════════════════════ */

function ScanView({onCreated,hasScan,scan}:{onCreated:(s:ScanRecord)=>void;hasScan:boolean;scan:ScanRecord|null}){
  const [name,setName]=useState('')
  const [ticker,setTicker]=useState('')
  const [listTxt,setListTxt]=useState('')
  const [themes,setThemes]=useState<Set<string>>(new Set())
  const [sam,setSam]=useState(false)
  const [errs,setErrs]=useState<{co?:string;themes?:string}>({})
  const [creating,setCreating]=useState(false)

  const companies=useCallback(():ParsedCo[]=>{
    const out:ParsedCo[]=[],seen=new Set<string>()
    if(name.trim()){seen.add(name.trim().toLowerCase());out.push({value:name.trim(),type:'name',src:'name'})}
    if(ticker.trim()){const up=ticker.trim().toUpperCase();if(TICKER_RE.test(up)&&!seen.has(up.toLowerCase())){seen.add(up.toLowerCase());out.push({value:up,type:'ticker',src:'ticker'})}}
    for(const c of parseList(listTxt)){if(!seen.has(c.value.toLowerCase())){seen.add(c.value.toLowerCase());out.push(c)}}
    return out
  },[name,ticker,listTxt])

  const toggleTheme=(id:string)=>{
    setThemes(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
    setErrs(e=>({...e,themes:undefined}))
  }

  const removeCompany=(idx:number)=>{
    const cos=companies(),rem=cos[idx]
    if(rem.src==='name')setName('')
    else if(rem.src==='ticker')setTicker('')
    else{
      const lines=listTxt.split(/[\n\r]+/).filter(l=>{
        const clean=l.replace(/^\s*\d+[\.\)\-\:]\s*/,'').replace(/["""'']/g,'').trim()
        return clean.toLowerCase()!==rem.value.toLowerCase()
      })
      setListTxt(lines.join('\n'))
    }
  }

  const validate=()=>{
    const e:{co?:string;themes?:string}={}
    if(companies().length===0)e.co='Add at least one company name, ticker, or paste a list.'
    if(themes.size===0)e.themes='Select at least one signal theme.'
    setErrs(e);return!e.co&&!e.themes
  }

  const handleCreate=async()=>{
    if(!validate())return
    setCreating(true)
    await new Promise(r=>setTimeout(r,400))
    const cos=companies()
    onCreated({id:'CRM-'+Date.now().toString(36).toUpperCase(),companies:cos,themes:(Array.from(themes) as string[]),sam,createdAt:new Date().toISOString()})
    setCreating(false)
  }

  const cos=companies()

  if(hasScan&&scan){
    return(
      <div>
        <div className="success">
          <div className="success-ico">✓</div>
          <div className="success-body">
            <div className="success-title">Scan created — pipeline running</div>
            <div className="success-meta">
              ID: <code>{scan.id}</code> · {scan.companies.length} {scan.companies.length===1?'company':'companies'} · {scan.themes.length} signal {scan.themes.length===1?'theme':'themes'}<br/>
              Resolution, scoring, and source collection are complete. Navigate to Resolution or Scoring to review results.
            </div>
          </div>
          <button className="btn-ghost" onClick={()=>window.location.reload()}>New scan</button>
        </div>
      </div>
    )
  }

  return(
    <div className="card">
      {/* Company input */}
      <div className="section">
        <div className="sec-label">Company input</div>
        <div className="row2">
          <div className="fwrap">
            <label className="flabel">Company name</label>
            <input type="text" placeholder="e.g. Terabase Energy" value={name} onChange={e=>{setName(e.target.value);setErrs(v=>({...v,co:undefined}))}} className={errs.co?'err-input':''} />
          </div>
          <div className="fwrap">
            <label className="flabel">Ticker symbol</label>
            <input type="text" placeholder="e.g. LECO" value={ticker} onChange={e=>{setTicker(e.target.value.toUpperCase());setErrs(v=>({...v,co:undefined}))}} className={errs.co?'err-input':''} />
          </div>
        </div>
        <div className="fwrap">
          <label className="flabel">Company list</label>
          <textarea placeholder={'Paste any format — numbered lists, tabs, commas, or one per line.\n\nExample:\n1. Terabase Energy\n2. Lincoln Electric\n3. CBRE\n4. Generate Biomedicines'} value={listTxt} onChange={e=>{setListTxt(e.target.value);setErrs(v=>({...v,co:undefined}))}} className={errs.co?'err-input':''} rows={6} />
          <span className="fhint">Accepts company names, tickers, numbered lists, tabs, commas, and mixed formats</span>
        </div>
        {errs.co&&<div className="err-msg">{errs.co}</div>}
        {cos.length>0&&(
          <div className="parsed-box">
            <div className="parsed-hd">
              <span className="parsed-ct">{cos.length} {cos.length===1?'company':'companies'} parsed</span>
              <button className="clear-lnk" onClick={()=>{setName('');setTicker('');setListTxt('')}}>Clear all</button>
            </div>
            <div className="tags">
              {cos.map((c,i)=>(
                <span key={i} className="co-tag">
                  <span className="tag-type">{c.type}</span>
                  {c.value}
                  <button className="tag-x" onClick={()=>removeCompany(i)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Themes */}
      <div className="section">
        <div className="sec-label">Signal themes</div>
        <div className="theme-grid">
          {THEMES.map(t=>{
            const sel=themes.has(t.id)
            return(
              <button key={t.id} className="theme-chip" onClick={()=>toggleTheme(t.id)}
                style={sel?{borderColor:t.color,background:t.color+'12',boxShadow:`0 0 0 1px ${t.color}22`}:{}}>
                <span className="chip-dot" style={{background:sel?t.color:undefined}}/>
                <span className="chip-lbl" style={sel?{color:t.color,fontWeight:500}:{}}>{t.label}</span>
              </button>
            )
          })}
        </div>
        {errs.themes&&<div className="err-msg" style={{marginTop:10}}>{errs.themes}</div>}
      </div>

      {/* Defaults */}
      <div className="section">
        <div className="sec-label">Defaults</div>
        <div className="def-row">
          <div className="def-badge"><div className="def-lbl">Market</div><div className="def-val">United States</div></div>
          <div className="def-badge"><div className="def-lbl">Source mode</div><div className="def-val">Low cost public</div></div>
        </div>
      </div>

      {/* SAM.gov */}
      <div className="section">
        <div className="sec-label">Enrichment</div>
        <div className="tog-row">
          <div className="tog-info">
            <div className="tog-title">SAM.gov enrichment</div>
            <div className="tog-desc">Include federal contractor and public sector signals. Useful for companies with government contracts or defence-adjacent operations.</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={sam} onChange={e=>setSam(e.target.checked)}/>
            <span className="tog-track"/>
          </label>
        </div>
      </div>

      {/* Footer */}
      <div className="card-foot">
        <span className="foot-hint">{cos.length} {cos.length===1?'company':'companies'} · {themes.size} {themes.size===1?'theme':'themes'} selected</span>
        <button className="btn-primary" onClick={handleCreate} disabled={creating}>
          {creating?'Creating scan…':'Create scan →'}
        </button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════
   F02 — RESOLUTION VIEW
══════════════════════════════════════════════ */

function ResolveView({companies,hasScan}:{companies:Company[];hasScan:boolean}){
  const [expanded,setExpanded]=useState<Set<string>>(new Set())
  if(!hasScan) return <EmptyState msg="Create a scan first to see resolution results." />

  const toggle=(id:string)=>setExpanded(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})

  return(
    <div style={{maxWidth:700}}>
      <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        {['public','hybrid','private'].map(t=>{
          const ct=companies.filter(c=>c.track===t).length
          return ct>0&&(
            <div key={t} style={{background:'var(--c-parchm)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-md)',padding:'10px 16px'}}>
              <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--c-ink5)',marginBottom:3}}>{t}</div>
              <div style={{fontSize:20,fontWeight:500,color:'var(--c-ink1)',fontFamily:'var(--f-mono)'}}>{ct}</div>
            </div>
          )
        })}
      </div>

      <div className="co-results">
        {companies.map(co=>(
          <div key={co.id}>
            <div className={`co-result${expanded.has(co.id)?' expanded':''}`} onClick={()=>toggle(co.id)}>
              <div style={{width:8,height:8,borderRadius:'50%',background:co.partial?'#BA7517':co.track==='private'?'#2D3B6B':'#2A4A38',flexShrink:0}}/>
              <div className="co-name">{co.name}</div>
              <span className={`track-pill tp-${co.track}`}>{co.track}</span>
              {co.cik&&<span style={{fontSize:11,color:'var(--c-ink5)',fontFamily:'var(--f-mono)'}}>{co.cik}</span>}
              {co.formDFiled&&<span style={{fontSize:10,background:'rgba(45,59,107,0.1)',color:'var(--s-ai)',padding:'2px 7px',borderRadius:3,fontWeight:500}}>Form D ✓</span>}
              <span className="chevron-ico" style={{fontSize:12,color:'var(--c-ink6)',transform:expanded.has(co.id)?'rotate(90deg)':'none',transition:'transform 0.15s'}}>▶</span>
            </div>
            {expanded.has(co.id)&&(
              <div style={{background:'var(--c-parchm)',border:'0.5px solid var(--c-copper)',borderTop:'none',borderRadius:'0 0 var(--r-md) var(--r-md)',padding:'12px 16px',marginBottom:2}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                  {[
                    ['Track',co.track],
                    ['Stage',co.stage],
                    co.cik?['CIK',co.cik]:null,
                    co.ticker?['Ticker',co.ticker]:null,
                    co.sic?['SIC',`${co.sic} · ${co.sicDesc}`]:null,
                    co.formDAmount?['Form D',co.formDAmount]:null,
                    co.investors?['Investors',co.investors]:null,
                    ['Data quality',`${co.dq} / 100`],
                  ].filter((x): x is [string,string] => Array.isArray(x)).map(([k,v],i)=>(
                    <div key={i} style={{background:'var(--c-paper)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-sm)',padding:'7px 10px'}}>
                      <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',color:'var(--c-ink5)',marginBottom:2}}>{k}</div>
                      <div style={{fontSize:12,color:'var(--c-ink1)',fontFamily:k==='CIK'||k==='Ticker'?'var(--f-mono)':'var(--f-body)'}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:11,color:'var(--c-ink4)',fontStyle:'italic'}}>{co.note}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════
   F05 — SCORING VIEW
══════════════════════════════════════════════ */

function ScoreView({companies,scores,signals,hasScan}:{companies:Company[];scores:Record<string,CompanyScore>;signals:Record<string,Signal[]>;hasScan:boolean}){
  const [expanded,setExpanded]=useState<Set<string>>(new Set())
  if(!hasScan) return <EmptyState msg="Create a scan first to see evidence scores." />

  const toggle=(id:string)=>setExpanded(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})

  return(
    <div style={{maxWidth:700}}>
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        {['Outreach ready','Outreach with caveats','Watch list'].map(r=>{
          const ct=companies.filter(c=>scores[c.id]?.readiness===r).length
          const cls=r==='Outreach ready'?'rb-ready':r==='Outreach with caveats'?'rb-caveat':'rb-watch'
          return(
            <div key={r} style={{background:'var(--c-parchm)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-md)',padding:'10px 16px'}}>
              <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',color:'var(--c-ink5)',marginBottom:3}}>{r}</div>
              <div style={{fontSize:20,fontWeight:500,fontFamily:'var(--f-mono)',color:'var(--c-ink1)'}}>{ct}</div>
            </div>
          )
        })}
      </div>

      <div className="co-results">
        {companies.map((co,i)=>{
          const sc=scores[co.id]
          if(!sc)return null
          const sigs=signals[co.id]||[]
          const isExp=expanded.has(co.id)
          const gcls=sc.grade==='A'?'gc-a':sc.grade==='B'?'gc-b':sc.grade==='C'?'gc-c':'gc-d'
          const rbcls=sc.readiness==='Outreach ready'?'rb-ready':sc.readiness==='Outreach with caveats'?'rb-caveat':'rb-watch'
          const scoreColor=sc.final>=65?'var(--st-green)':sc.final>=45?'var(--st-amber)':'var(--st-red)'

          return(
            <div key={co.id}>
              <div className={`co-result${isExp?' expanded':''}`} onClick={()=>toggle(co.id)}>
                <div style={{fontSize:12,fontWeight:500,color:'var(--c-ink5)',fontFamily:'var(--f-mono)',minWidth:18,textAlign:'center'}}>{i+1}</div>
                <div className="co-name">{co.name}</div>
                <span className={`rb ${rbcls}`}>{sc.readiness}</span>
                <div className={`grade-circle ${gcls}`}>{sc.grade}</div>
                <div className="score-display" style={{color:scoreColor}}>{sc.final}</div>
                <span className="chevron-ico" style={{fontSize:12,color:'var(--c-ink6)',transform:isExp?'rotate(90deg)':'none',transition:'transform 0.15s'}}>▶</span>
              </div>
              {isExp&&(
                <div style={{background:'var(--c-parchm)',border:'0.5px solid var(--c-copper)',borderTop:'none',borderRadius:'0 0 var(--r-md) var(--r-md)',padding:'14px 16px',marginBottom:2}}>
                  {sc.capped&&<div className="inf-note">Stage cap applied: raw score {sc.raw} reduced to {sc.final} for {co.stage} stage.</div>}

                  {/* Score calc */}
                  <div style={{background:'var(--c-paper)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-md)',padding:'10px 14px',marginBottom:12}}>
                    {Object.entries(sc.dims).map(([k,v])=>(
                      <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0',borderBottom:'0.5px solid var(--c-ink8)'}}>
                        <span style={{color:'var(--c-ink4)'}}>{k.replace(/_/g,' ')}</span>
                        <span style={{color:'var(--c-ink1)',fontFamily:'var(--f-mono)',fontWeight:500}}>{Math.round(v*(sc.model==='public'?PUBLIC_WEIGHTS[k as keyof typeof PUBLIC_WEIGHTS]:PRIVATE_WEIGHTS[k as keyof typeof PRIVATE_WEIGHTS])||0)}</span>
                      </div>
                    ))}
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'5px 0',fontWeight:600}}>
                      <span style={{color:'var(--c-ink3)'}}>Final score</span>
                      <span style={{color:scoreColor,fontFamily:'var(--f-mono)'}}>{sc.final}</span>
                    </div>
                  </div>

                  {/* Theme coverage */}
                  <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:12}}>
                    {THEMES.map(t=>(
                      <span key={t.id} className={`theme-tag ${t.cls}`} style={!(sc.themesHit||[]).includes(t.id)?{opacity:.35}:{}}>{t.label}</span>
                    ))}
                  </div>

                  {/* Top signals */}
                  <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--c-ink5)',marginBottom:6}}>Top signals</div>
                  <div className="signal-list">
                    {sigs.sort((a,b)=>b.adjStr-a.adjStr).slice(0,3).map(s=>(
                      <div key={s.id} className="signal-row">
                        <div className="signal-dot" style={{background:THEME_MAP[s.theme]?.color||'#888'}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div className="signal-lbl">{s.label}</div>
                          <div className="signal-meta">{s.days}d ago</div>
                        </div>
                        <span className={`tier-b ${tierCls(s.tier)}`}>{tierLabel(s.tier)}</span>
                        <span className={`conf-b cb-${s.conf}`}>{s.conf}</span>
                        <div className="adj-score">{s.adjStr}</div>
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

/* ══════════════════════════════════════════════
   F07 — STAKEHOLDER ROLES VIEW
══════════════════════════════════════════════ */

const ACTION_META:{[k:string]:{label:string;cls:string}} = {
  founder_direct:                {label:'Founder direct outreach',     cls:'act-founder'},
  first_outreach_target:         {label:'Best first outreach target',  cls:'act-first'},
  technical_owner_to_validate:   {label:'Technical owner to validate', cls:'act-technical'},
  executive_sponsor_to_map:      {label:'Executive sponsor to map',    cls:'act-sponsor'},
  operational_owner:             {label:'Operational owner',           cls:'act-op'},
  capability_builder:            {label:'Capability builder',          cls:'act-cap'},
  conditional_target:            {label:'Conditional — verify first',  cls:'act-cond'},
}

function RolesView({companies,scores,roles,onGenerate,hasScan}:{
  companies:Company[];scores:Record<string,CompanyScore>;
  roles:Record<string,StakeholderRole[]>;onGenerate:(co:Company)=>Promise<void>;hasScan:boolean
}){
  const [selCo,setSelCo]=useState<string|null>(null)
  const [expanded,setExpanded]=useState<Set<string>>(new Set())
  const [loading,setLoading]=useState<Set<string>>(new Set())

  if(!hasScan) return <EmptyState msg="Create a scan first to map stakeholders." />

  const cos=companies.filter(c=>(scores[c.id]?.final||0)>=45)
  const activeCo:Company|undefined=(selCo?cos.find(c=>c.id===selCo):undefined)||cos[0]

  const handleGenerate=async(co:Company)=>{
    setLoading(prev=>{const n=new Set(prev);n.add(co.id);return n})
    await onGenerate(co)
    setLoading(prev=>{const n=new Set(prev);n.delete(co.id);return n})
  }

  const toggleRole=(k:string)=>setExpanded(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n})

  return(
    <div style={{display:'flex',gap:20,maxWidth:900,flexWrap:'wrap'}}>
      {/* Company selector */}
      <div style={{width:200,flexShrink:0}}>
        <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--c-ink5)',marginBottom:8}}>Select company</div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {cos.map(co=>{
            const sc=scores[co.id]
            const active=activeCo?.id===co.id
            return(
              <button key={co.id} onClick={()=>setSelCo(co.id)}
                style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',
                  borderRadius:'var(--r-md)',border:active?'0.5px solid var(--c-copper)':'0.5px solid var(--c-ink7)',
                  background:active?'var(--c-copper-lt)':'var(--c-parchm)',
                  cursor:'pointer',textAlign:'left',transition:'all 0.1s',width:'100%'}}>
                <div style={{fontSize:13,fontWeight:500,color:'var(--c-ink1)',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{co.name.split(' ')[0]}</div>
                <div style={{fontSize:12,fontWeight:500,fontFamily:'var(--f-mono)',color:active?'var(--c-copper)':'var(--c-ink4)'}}>{sc?.final}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Roles panel */}
      <div style={{flex:1,minWidth:320}}>
        {activeCo&&(
          <>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
              <h2 style={{fontFamily:'var(--f-display)',fontSize:18,fontWeight:500,color:'var(--c-ink0)',fontStyle:'italic',flex:1}}>{activeCo.name}</h2>
              {!roles[activeCo.id]&&(
                <button className="btn-primary" style={{padding:'7px 16px',fontSize:12}}
                  disabled={loading.has(activeCo.id)}
                  onClick={()=>handleGenerate(activeCo)}>
                  {loading.has(activeCo.id)?'Mapping…':'Map stakeholders →'}
                </button>
              )}
            </div>

            {!roles[activeCo.id]&&!loading.has(activeCo.id)&&(
              <div style={{background:'var(--c-parchm)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-lg)',padding:'20px 22px',fontSize:13,color:'var(--c-ink5)',fontStyle:'italic'}}>
                Click "Map stakeholders" to generate role recommendations grounded in the signal evidence.
              </div>
            )}

            {loading.has(activeCo.id)&&(
              <div style={{background:'var(--c-parchm)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-lg)',padding:'20px 22px',fontSize:13,color:'var(--c-ink5)',fontStyle:'italic'}}>
                Mapping stakeholders…
              </div>
            )}

            {roles[activeCo.id]?.map((r,i)=>{
              const key=`${activeCo.id}-${i}`
              const isExp=expanded.has(key)
              const am=ACTION_META[r.action]||ACTION_META.conditional_target
              const priCls=r.priority==='primary'?'b-primary':r.priority==='secondary'?'b-secondary':'b-tertiary'
              const scoreColor=r.score>=75?'var(--st-green)':r.score>=55?'var(--st-amber)':'var(--st-red)'
              return(
                <div key={key} className={`role-card${r.priority==='primary'?' primary':''}`}>
                  <div className="role-head" onClick={()=>toggleRole(key)}>
                    <div className="role-title-col">
                      <div className="role-title">{r.title}</div>
                      <div className="badge-row">
                        <span className={`badge ${priCls}`}>{r.priority.charAt(0).toUpperCase()+r.priority.slice(1)}</span>
                        <span className={`badge ${am.cls}`}>{am.label}</span>
                      </div>
                    </div>
                    <div className="role-score" style={{color:scoreColor}}>{r.score}</div>
                    <span className="chevron-ico" style={{fontSize:12,color:'var(--c-ink6)',transform:isExp?'rotate(90deg)':'none',transition:'transform 0.15s'}}>▶</span>
                  </div>
                  {isExp&&(
                    <div className="role-detail open">
                      {r.inferenceNote&&<div className="inf-note">{r.inferenceNote}</div>}
                      <div className="role-section">
                        <div className="role-sec-label">Why this role matters</div>
                        <div className="role-text">{r.whyMatters}</div>
                      </div>
                      <div className="role-section">
                        <div className="role-sec-label">How to use this contact</div>
                        <div className="role-text">{r.howToUse}</div>
                      </div>
                      <div className="cr-grid">
                        <div className="cr-card">
                          <div className="cr-lbl">Evidence confidence</div>
                          <div className={`cr-val ch-${r.evidenceConf.toLowerCase()}`}>{r.evidenceConf}</div>
                          <div className="cr-note">{r.evidenceConfNote}</div>
                        </div>
                        <div className="cr-card">
                          <div className="cr-lbl">Inference risk</div>
                          <div className={`cr-val ri-${r.inferenceRisk.toLowerCase()}`}>{r.inferenceRisk}</div>
                          <div className="cr-note">{r.inferenceRiskNote}</div>
                        </div>
                      </div>
                      <div className="role-section">
                        <div className="role-sec-label">Cold call topic menu</div>
                        <div className="topic-list">
                          {r.topics.map((t,ti)=>(
                            <div key={ti} className="topic-item">
                              <span className="t-num">{ti+1}</span>
                              <span className="t-txt">{t.text}</span>
                              <span className={`t-tag ${t.tag==='evidence'?'t-ev':t.tag==='inferred'?'t-inf':'t-spec'}`}>{t.tag}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="role-section">
                        <div className="role-sec-label">Suggested first question</div>
                        <div className="first-q">{r.firstQ}</div>
                      </div>
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

/* ══════════════════════════════════════════════
   F08/09 — OUTREACH VIEW
══════════════════════════════════════════════ */

function OutreachView({companies,scores,roles,liDrafts,emailDrafts,onSetLI,onSetEmail,generateLI,generateEmail,hasScan}:{
  companies:Company[];scores:Record<string,CompanyScore>;
  roles:Record<string,StakeholderRole[]>;
  liDrafts:Record<string,string>;emailDrafts:Record<string,OutreachDraft>;
  onSetLI:(k:string,v:string)=>void;onSetEmail:(k:string,v:OutreachDraft)=>void;
  generateLI:(coId:string,ri:number,tone:string)=>Promise<string>;
  generateEmail:(coId:string,ri:number,tone:string)=>Promise<OutreachDraft>;
  hasScan:boolean
}){
  const [selCo,setSelCo]=useState<string|null>(null)
  const [selRole,setSelRole]=useState(0)
  const [tab,setTab]=useState<'li'|'email'>('li')
  const [tone,setTone]=useState('consultative')
  const [loading,setLoading]=useState(false)

  if(!hasScan) return <EmptyState msg="Create a scan and map stakeholders to draft outreach." />

  const cos=companies.filter(c=>roles[c.id]?.length>0)
  if(cos.length===0) return <EmptyState msg="Map stakeholders first — go to the Stakeholders tab." />

  const activeCo:Company|undefined=(selCo?cos.find(c=>c.id===selCo):undefined)||cos[0]
  const activeRoles=roles[activeCo?.id||'']||[]
  const activeRole=activeRoles[selRole]
  const draftKey=`${activeCo?.id}-${selRole}-${tone}`
  const liDraft=liDrafts[draftKey]
  const emailDraft=emailDrafts[draftKey]
  const liLen=liDraft?14+liDraft.length:0

  const hasDash=(s:string)=>/[-\u2013\u2014]/.test(s)

  const handleGenerate=async()=>{
    if(!activeCo||!activeRole)return
    setLoading(true)
    try{
      if(tab==='li'){
        const d=await generateLI(activeCo.id,selRole,tone)
        onSetLI(draftKey,d)
      } else {
        const d=await generateEmail(activeCo.id,selRole,tone)
        onSetEmail(draftKey,d)
      }
    } catch(e){ console.error(e) }
    setLoading(false)
  }

  const copyText=(txt:string,btn:HTMLButtonElement)=>{
    navigator.clipboard.writeText(txt).then(()=>{
      btn.textContent='Copied';btn.classList.add('copied')
      setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},2000)
    })
  }

  return(
    <div style={{display:'flex',gap:20,maxWidth:900,flexWrap:'wrap'}}>
      {/* Company+role selector */}
      <div style={{width:200,flexShrink:0}}>
        <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--c-ink5)',marginBottom:8}}>Company</div>
        <div style={{display:'flex',flexDirection:'column',gap:3,marginBottom:16}}>
          {cos.map(co=>(
            <button key={co.id} onClick={()=>{setSelCo(co.id);setSelRole(0)}}
              style={{padding:'8px 12px',borderRadius:'var(--r-md)',
                border:activeCo?.id===co.id?'0.5px solid var(--c-copper)':'0.5px solid var(--c-ink7)',
                background:activeCo?.id===co.id?'var(--c-copper-lt)':'var(--c-parchm)',
                cursor:'pointer',textAlign:'left',fontSize:12,fontWeight:500,color:'var(--c-ink1)',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',transition:'all 0.1s'}}>
              {co.name.split(' ').slice(0,2).join(' ')}
            </button>
          ))}
        </div>

        {activeRoles.length>0&&(
          <>
            <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--c-ink5)',marginBottom:8}}>Role</div>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              {activeRoles.map((r,i)=>(
                <button key={i} onClick={()=>setSelRole(i)}
                  style={{padding:'8px 12px',borderRadius:'var(--r-md)',
                    border:selRole===i?'0.5px solid var(--c-copper)':'0.5px solid var(--c-ink7)',
                    background:selRole===i?'var(--c-copper-lt)':'var(--c-parchm)',
                    cursor:'pointer',textAlign:'left',fontSize:11,lineHeight:1.4,transition:'all 0.1s'}}>
                  <div style={{fontWeight:500,color:'var(--c-ink1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title.split('/')[0].trim()}</div>
                  <div style={{fontSize:10,color:'var(--c-ink5)',marginTop:2}}>{ACTION_META[r.action]?.label||r.action}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Draft panel */}
      <div style={{flex:1,minWidth:300}}>
        {activeCo&&activeRole&&(
          <>
            <div style={{marginBottom:14}}>
              <h2 style={{fontFamily:'var(--f-display)',fontSize:16,fontWeight:500,color:'var(--c-ink0)',fontStyle:'italic',marginBottom:3}}>{activeRole.title}</h2>
              <div style={{fontSize:12,color:'var(--c-ink5)',fontStyle:'italic'}}>{activeCo.name}</div>
            </div>

            <div className="draft-tabs">
              <button className={`dtab${tab==='li'?' active':''}`} onClick={()=>setTab('li')}>LinkedIn connect</button>
              <button className={`dtab${tab==='email'?' active':''}`} onClick={()=>setTab('email')}>First-touch email</button>
            </div>

            <div className="tone-row">
              <span className="tone-lbl">Tone:</span>
              {['consultative','direct','challenger'].map(t=>(
                <button key={t} className={`tone-btn${tone===t?' active':''}`} onClick={()=>setTone(t)}>
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                </button>
              ))}
            </div>

            {tab==='li'&&(
              <>
                <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--c-ink5)',marginBottom:8}}>LinkedIn connection message · 300 character limit</div>
                <div className="li-mock">
                  <div className="li-mock-head">
                    <div className="li-avatar">{activeRole.title[0]}</div>
                    <div>
                      <div className="li-name">{activeRole.title}</div>
                      <div className="li-role-lbl">{activeCo.name}</div>
                    </div>
                  </div>
                  {liDraft
                    ?<><div className="msg-box"><span className="name-ph">[First name], </span>{liDraft}</div>
                      <div className="char-row">
                        <div className="char-bg"><div className="char-fill" style={{width:`${Math.min(liLen/300*100,100)}%`,background:liLen>300?'var(--st-red)':'var(--st-green)'}}/></div>
                        <span className={`char-num ${liLen>300?'over':liLen>280?'warn':'ok'}`}>{liLen} / 300</span>
                        <span style={{fontSize:10,color:'var(--c-ink5)'}}>(14 reserved for name)</span>
                      </div>
                      {hasDash(liDraft)&&<div className="dash-warn" style={{display:'block'}}>Contains a dash — regenerate to fix</div>}
                    </>
                    :<div className="msg-box empty">Select tone and click Generate to create your LinkedIn message.</div>
                  }
                </div>
                <div className="btn-row">
                  <button className="btn-primary" onClick={handleGenerate} disabled={loading}>{loading?'Generating…':liDraft?'Regenerate →':'Generate →'}</button>
                  {liDraft&&<button className="btn-sm" onClick={e=>copyText('[First name], '+liDraft,e.currentTarget)}>Copy</button>}
                </div>
              </>
            )}

            {tab==='email'&&(
              <>
                <div style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--c-ink5)',marginBottom:8}}>First-touch email</div>
                <div className="email-mock">
                  <div style={{marginBottom:10}}>
                    <div className="em-row"><span className="em-lbl">To:</span><span className="em-val">{activeRole.title}</span></div>
                    <div className="em-row"><span className="em-lbl">Subject:</span><span className="em-val">{emailDraft?.subject||'—'}</span></div>
                  </div>
                  {emailDraft
                    ?<><div className="email-body">{emailDraft.body}</div>
                      {hasDash(emailDraft.body)&&<div className="dash-warn" style={{display:'block'}}>Contains a dash — regenerate to fix</div>}
                    </>
                    :<div className="email-body empty">Select tone and click Generate to create your first-touch email.</div>
                  }
                </div>
                <div className="btn-row">
                  <button className="btn-primary" onClick={handleGenerate} disabled={loading}>{loading?'Generating…':emailDraft?'Regenerate →':'Generate →'}</button>
                  {emailDraft&&<button className="btn-sm" onClick={e=>copyText(`Subject: ${emailDraft.subject}\n\n${emailDraft.body}`,e.currentTarget)}>Copy</button>}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════
   F10 — EXPORT VIEW
══════════════════════════════════════════════ */

function ExportView({companies,scores,signals,roles,liDrafts,emailDrafts,hasScan}:{
  companies:Company[];scores:Record<string,CompanyScore>;signals:Record<string,Signal[]>;
  roles:Record<string,StakeholderRole[]>;liDrafts:Record<string,string>;emailDrafts:Record<string,OutreachDraft>;hasScan:boolean
}){
  if(!hasScan) return <EmptyState msg="Create a scan to generate exportable account summaries." />

  function buildSummary(co:Company):string {
    const sc=scores[co.id]
    const sigs=signals[co.id]||[]
    const coRoles=roles[co.id]||[]
    const lines:string[]=[]
    lines.push(`CREAM — ACCOUNT INTELLIGENCE SUMMARY`)
    lines.push(`Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`)
    lines.push(``)
    lines.push(`Company: ${co.name}`)
    lines.push(`Track: ${co.track} · Stage: ${co.stage}`)
    if(co.cik)lines.push(`CIK: ${co.cik}`)
    if(sc){lines.push(`Evidence score: ${sc.final} / 100 · Grade: ${sc.grade} · ${sc.readiness}`)}
    lines.push(``)
    if(sigs.length){
      lines.push(`SIGNALS`)
      sigs.sort((a,b)=>b.adjStr-a.adjStr).forEach((s,i)=>{
        lines.push(`${i+1}. [${s.theme.toUpperCase()}] ${s.label}`)
        lines.push(`   Adjusted score: ${s.adjStr} · ${tierLabel(s.tier)} (${s.days}d ago) · ${s.srcType}`)
      })
      lines.push(``)
    }
    if(coRoles.length){
      lines.push(`STAKEHOLDER ROLES`)
      coRoles.forEach((r,i)=>{
        lines.push(`${i+1}. ${r.title}`)
        lines.push(`   Use: ${ACTION_META[r.action]?.label} · Confidence: ${r.evidenceConf} · Inference risk: ${r.inferenceRisk}`)
        r.topics.forEach((t,ti)=>lines.push(`   ${ti+1}. ${t.text}`))
        lines.push(`   First question: ${r.firstQ}`)
        lines.push(``)
      })
    }
    const liKey=Object.keys(liDrafts).find(k=>k.startsWith(co.id))
    const emKey=Object.keys(emailDrafts).find(k=>k.startsWith(co.id))
    if(liKey&&liDrafts[liKey]){
      lines.push(`LINKEDIN MESSAGE`)
      lines.push(`[First name], ${liDrafts[liKey]}`)
      lines.push(``)
    }
    if(emKey&&emailDrafts[emKey]){
      lines.push(`FIRST-TOUCH EMAIL`)
      lines.push(`Subject: ${emailDrafts[emKey].subject}`)
      lines.push(``)
      lines.push(emailDrafts[emKey].body)
    }
    return lines.join('\n')
  }

  function downloadTxt(co:Company){
    const txt=buildSummary(co)
    const blob=new Blob([txt],{type:'text/plain'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a')
    a.href=url;a.download=`${co.name.replace(/\s+/g,'_')}_cream_intel_${new Date().toISOString().slice(0,10)}.txt`
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url)
  }

  function copyAll(){
    const all=companies.map(buildSummary).join('\n\n'+('─').repeat(60)+'\n\n')
    navigator.clipboard.writeText(all)
  }

  return(
    <div className="export-card">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <h2 style={{fontFamily:'var(--f-display)',fontSize:20,fontWeight:500,color:'var(--c-ink0)',fontStyle:'italic'}}>Account summaries</h2>
        <button className="btn-ghost" onClick={copyAll}>Copy all</button>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:20}}>
        {companies.map(co=>{
          const sc=scores[co.id]
          const gcls=!sc?'':sc.grade==='A'?'gc-a':sc.grade==='B'?'gc-b':sc.grade==='C'?'gc-c':'gc-d'
          const hasRoles=!!(roles[co.id]?.length)
          const hasLI=Object.keys(liDrafts).some(k=>k.startsWith(co.id))
          const hasEmail=Object.keys(emailDrafts).some(k=>k.startsWith(co.id))
          return(
            <div key={co.id} className="export-co">
              {sc&&<div className={`grade-circle ${gcls}`}>{sc.grade}</div>}
              <div className="export-co-name">{co.name}</div>
              {sc&&<span style={{fontSize:12,fontFamily:'var(--f-mono)',color:'var(--c-ink4)'}}>{sc.final}</span>}
              <div style={{display:'flex',gap:4}}>
                {hasRoles&&<span style={{fontSize:9,background:'var(--st-green-bg)',color:'var(--st-green)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>ROLES</span>}
                {hasLI&&<span style={{fontSize:9,background:'rgba(45,59,107,0.1)',color:'var(--s-ai)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>LI</span>}
                {hasEmail&&<span style={{fontSize:9,background:'var(--c-copper-lt)',color:'var(--c-copper)',padding:'2px 6px',borderRadius:3,fontWeight:600}}>EMAIL</span>}
              </div>
              <button className="btn-sm" onClick={()=>downloadTxt(co)}>Download .txt</button>
              <button className="btn-sm" onClick={()=>navigator.clipboard.writeText(buildSummary(co))}>Copy</button>
            </div>
          )
        })}
      </div>

      <div style={{padding:'14px 16px',background:'var(--c-parchm)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-md)',fontSize:12,color:'var(--c-ink5)',fontStyle:'italic',lineHeight:1.6}}>
        Each account summary includes the evidence chain, dimension scores, stakeholder roles, cold call topics, and outreach drafts in a clean plain text format ready to paste into a CRM, brief, or email.
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════
   SHARED — EMPTY STATE
══════════════════════════════════════════════ */

function EmptyState({msg}:{msg:string}){
  return(
    <div style={{maxWidth:500}}>
      <div style={{background:'var(--c-parchm)',border:'0.5px solid var(--c-ink7)',borderRadius:'var(--r-lg)',padding:'28px 28px',textAlign:'center'}}>
        <div style={{fontFamily:'var(--f-display)',fontSize:28,color:'var(--c-warm3)',marginBottom:12,fontStyle:'italic'}}>◈</div>
        <div style={{fontSize:13,color:'var(--c-ink4)',fontStyle:'italic',lineHeight:1.6}}>{msg}</div>
      </div>
    </div>
  )
}
